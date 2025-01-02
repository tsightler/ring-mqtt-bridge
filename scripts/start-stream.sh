#!/bin/bash
# Activate Ring camera video stream via ring-mqtt
#
# This script is intended for use only with ring-mqtt
# and go2rtc.
#
# Requires mosquitto MQTT clients package to be installed
# Uses ring-mqtt internal IPC broker for communication with
# ring-mqtt process
#
# Spawns stream control in background due to issues with
# process exit hanging go2rtc.  Script then just monitors
# for control script to exit or, if script is killed,
# sends commands to control script prior to exiting

# Required command line arguments
device_id=${1}     # Camera device Id
type=${2}          # Stream type ("live"/"event"/"snapshot")
base_topic=${3}    # Command topic for Camera entity
rtsp_pub_url=${4}  # URL for publishing RTSP stream
client_id="${device_id}_${type}"  # Id used to connect to the MQTT broker, camera Id + event type

# If previous run hasn't exited yet, just perform a short wait and exit with error
if test -f /tmp/ring-mqtt-${client_id}.lock; then
    sleep .1
    exit 1
else
    touch /tmp/ring-mqtt-${client_id}.lock
fi

script_dir=$(dirname "$0")
${script_dir}/monitor-stream.sh ${1} ${2} ${3} ${4} &

# Build the MQTT topics
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

stop() {
    # Interrupted by signal so send command to stop stream
    # Send message to monitor script that stream was requested to stop so that it doesn't log a warning
    mosquitto_pub -i "${client_id}_pub" -L "mqtt://127.0.0.1:51883/${json_attribute_topic}" -m {\"status\":\"deactivate\"}

    # Send ring-mqtt the command to stop the stream
    mosquitto_pub -i "${client_id}_pub" -L "mqtt://127.0.0.1:51883/${debug_topic}" -m "Deactivating ${type} stream due to signal from RTSP server (no more active clients or publisher ended stream)"
    mosquitto_pub -i "${client_id}_pub" -L "mqtt://127.0.0.1:51883/${command_topic}" -m "OFF"

    # Send kill signal to monitor script and wait for it to exit
    local pids=$(jobs -pr)
    [ -n "$pids" ] && kill $pids
    wait
    cleanup
}

# If control script is still runnning send kill signal and exit
cleanup() {
    rm -f /tmp/ring-mqtt-${client_id}.lock
    # For some reason sleeping for 100ms seems to keep go2rtc from hanging
    exit 0
}

# Send debug logs via main process using MQTT messages
logger() {
    mosquitto_pub -i "${client_id}_pub" -L "mqtt://127.0.0.1:51883/${debug_topic}" -m "${1}"
}

# Trap signals so that the MQTT command to stop the stream can be published on exit
trap stop INT TERM EXIT

logger "Sending command to activate ${type} stream ON-DEMAND"
mosquitto_pub -i "${client_id}_pub" -L "mqtt://127.0.0.1:51883/${command_topic}" -m "ON-DEMAND ${rtsp_pub_url}" &

wait
cleanup