#!/bin/bash
# Activate video stream on Ring cameras via ring-mqtt
# Intended only for use as on-demand script for rtsp-simple-server
# Requires mosquitto MQTT clients package to be installed
# Uses ring-mqtt internal IPC broker for communications with main process
# Provides status updates and termintates stream on script exit

# Required command line arguments
device_id=${1}     # Camera device Id
type=${2}          # Stream type ("live" or "event")
base_topic=${3}    # Command topic for Camera entity
rtsp_pub_url=${4}  # URL for publishing RTSP stream
client_id="${device_id}_${type}"  # Id used to connect to the MQTT broker, camera Id + event type
activated="false"
reason="none"

[[ ${type} = "live" ]] && base_topic="${base_topic}/stream" || base_topic="${base_topic}/${type}_stream"
json_attribute_topic="${base_topic}/attributes"
command_topic="${base_topic}/command"
debug_topic="${base_topic}/debug"

# Set some colors for debug output
red='\e[0;31m'
yellow='\e[0;33m'
green='\e[0;32m'
blue='\e[0;34m'
reset='\e[0m'

cleanup() {
    local ffpids=$(pgrep -f "ffmpeg.*${rtsp_pub_url}" | grep -v ^$$\$)
    [ -n "$ffpids" ] && kill -9 $ffpids
    local pids=$(pgrep -f "mosquitto_sub.*${client_id}_sub" | grep -v ^$$\$)
    [ -n "$pids" ] && kill $pids
    exit 0
}

# go2rtc does not pass stdout through from child processes so send debug logs
# via main process using MQTT messages
logger() {
    mosquitto_pub -i "${client_id}_pub" -L "mqtt://127.0.0.1:51883/${debug_topic}" -m "${1}"
}

# Trap signals so that the MQTT command to stop the stream can be published on exit
trap cleanup INT TERM

# This loop starts mosquitto_sub with a subscription on the camera stream topic that sends all received
# messages via file descriptor to the read process. On initial startup the script publishes the message
# 'ON-DEMAND' to the stream command topic which lets ring-mqtt know that an RTSP client has requested
# the stream.  Stream state is determined via the the detailed stream state messages received via the
# json_attributes_topic:
#
# "inactive" = There is no active video stream and none currently requested
# "activating" = A video stream has been requested and is initializing but has not yet started
# "active" = The stream was requested successfully and an active stream is currently in progress
# "failed" = A live stream was requested but failed to start
mosquitto_sub -q 1 -i "${client_id}_sub" -L "mqtt://127.0.0.1:51883/${json_attribute_topic}" |
while read message; do
    # Otherwise it should be a JSON message from the stream state attribute topic so extract the detailed stream state
    stream_state=`echo ${message} | jq -r '.status'`
    case ${stream_state,,} in
        activating)
            if [ ${activated} = "false" ]; then
                logger "State indicates ${type} stream is activating"
            fi
            ;;
        active)
            if [ ${activated} = "false" ]; then
                logger "State indicates ${type} stream is active"
                activated="true"
            fi
            ;;
        deactivate)
            if [ ${activated} = "true" ]; then
                reason='deactivate'
            fi
            ;;
        inactive)
            if [ ${reason} = "deactivate" ] ; then
                logmsg="State indicates ${type} stream is inactive"
            else
                logmsg=$(echo -en "${yellow}State indicates ${type} stream has gone unexpectedly inactive${reset}")
            fi
            logger "${logmsg}"
            reason='inactive'
            cleanup
            ;;
        failed)
            logmsg=$(echo -en "${red}ERROR - State indicates ${type} stream failed to activate${reset}")
            logger "${logmsg}"
            reason='failed'
            cleanup
            ;;
        *)
            logmsg=$(echo -en "${red}ERROR - Received unknown ${type} stream state on topic ${blue}${json_attribute_topic}${reset}")
            logger "${logmsg}"
            ;;
    esac
done

cleanup