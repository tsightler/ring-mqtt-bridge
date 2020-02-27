const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Beam extends AlarmDevice {
    async init(mqttClient) {

        availabilityTopic = this.alarmTopic+'/beam/'+this.deviceId+'/status'
        
        // Build required MQTT topics for device for each entity        
        if (this.device.data.deviceType === 'group.light-group.beams') {
            this.isLightGroup = true
            this.groupId = this.device.data.groupId
        }

        if (deviceType !== 'switch.transformer.beams') {
            this.deviceTopic_motion = this.alarmTopic+'/binary_sensor/'+this.deviceId
            this.stateTopic_motion = this.deviceTopic_motion+'/motion_state'
            this.attributesTopic_motion = this.deviceTopic_motion+'/attributes'
            this.configTopic_motion = 'homeassistant/binary_sensor/'+this.locationId+'/'+this.deviceId+'/config'
        }

        if (deviceType !== 'motion-sensor.beams') {
            this.deviceTopic_light = this.alarmTopic+'/light/'+this.deviceId
            this.stateTopic_light = this.deviceTopic_light+'switch_state'
            this.commandTopic_light = this.deviceTopic_light+'switch_command'
            this.attributesTopic_light = this.deviceTopic_light+'/attributes'
            this.configTopic_light = 'homeassistant/light/'+this.locationId+'/'+this.deviceId+'/config'
        }

        if (deviceType === 'switch.multilevel.beams') {
            this.stateTopic_brightness = this.deviceTopic_light+'brightness_state'
            this.commandTopic_brightness = this.deviceTopic_light+'brightness_command'
        }

        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Publish discovery message for HA and wait 2 seoonds before sending state
        this.publishDiscovery(mqttClient)
        await utils.sleep(2)

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice(mqttClient)
    }

    publishDiscovery(mqttClient) {
        // Build the MQTT discovery messages and publish devices

        if (this.stateTopic_motion) {
            const message = {
                name: this.device.name+' - Motion',
                unique_id: this.deviceId+'_motion',
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_motion,
                json_attributes_topic: this.attributesTopic_motion,
                device_class: motion
            }
            debug('HASS config topic: '+this.configTopic_motion)
            debug(message)
            this.publishMqtt(mqttClient, this.configTopic_motion, JSON.stringify(message))    
        }

        if (this.stateTopic_light) {
            const message = {
                name: this.device.name+' - Light',
                unique_id: this.deviceId+'_light',
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_light,
                json_attributes_topic: this.attributesTopic_light,
                command_topic: this.commandTopic_light
            }

            if (this.stateTopic_brightness) {
                message_light.brightness_scale = 100
                message_light.brightness_state_topic = this.stateTopic_brightness,
                message_light.brightness_command_topic = this.commandTopic_brightness
            }
            debug('HASS config topic: '+this.configTopic_motion)
            debug(message)
            this.publishMqtt(mqttClient, this.configTopic_light, JSON.stringify(message))
            mqttClient.subscribe(this.commandTopic_light)
            if (this.stateTopic_brightness) { 
                mqttClient.subscribe(this.commandTopic_brightness)
            }            
        }
    }

    publishData(mqttClient) {
        if (this.stateTopic_motion) {
            const motionState = this.device.data.motionState === 'faulted' ? 'ON' : 'OFF'
            this.publishMqtt(mqttClient, this.stateTopic_motion, motionState, true)
            this.publishBeamAttributes(mqttClient, attributesTopic_motion)
        }
        if (this.stateTopic_light) {
            const switchState = this.device.data.on ? "ON" : "OFF"
            this.publishMqtt(mqttClient, this.stateTopic_light, switchState, true)
            if (this.stateTopic_brightness) {
                const switchLevel = (this.device.data.level && !isNaN(this.device.data.level) ? Math.round(100 * this.device.data.level) : 0)
                this.publishMqtt(mqttClient, this.stateTopic_brightness, switchLevel, true)
            }
            this.publishBeamAttributes(mqttClient, attributesTopic_light)
        }
    }

    // Publish device attributes
    publishBeamAttributes(mqttClient, attributesTopic) {
        const attributes = {}
        const batteryLevel = this.getBatteryLevel()
        if (batteryLevel !== 'none') {
            attributes.battery_level = batteryLevel
        }
        this.publishMqtt(mqttClient, attributesTopic, JSON.stringify(attributes), true)
    }

    // Process messages from MQTT command topic
    processCommand(message, cmdTopicLevel) {
        if (cmdTopicLevel == 'switch_command') {
            this.setSwitchState(message)
        } else if (cmdTopicLevel == 'brightness_command') {
            this.setSwitchLevel(message)
        } else {
            debug('Somehow received unknown command topic level '+cmdTopicLevel+' for switch Id: '+this.deviceId)
        }
    }

    // Set switch target state on received MQTT command message
    setSwitchState(message) {
        debug('Received set switch state '+message+' for switch Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off': {
                // TODO: Make this configurable
                const lightDuration = undefined
                let lightOn = command === 'on' ? true : false
                if (this.isLightGroup && this.groupId) {
                    this.device.location.setLightGroup(this.groupId, lightOn, lightDuration)
                } else {
                    const data = lightOn ? { lightMode: 'on', lightDuration } : { lightMode: 'default' }
                    this.device.sendCommand('light-mode.set', data)
                }
                break;
            }
            default:
                debug('Received invalid command for switch!')
        }
    }

    // Set switch target state on received MQTT command message
    setSwitchLevel(message) {
        const level = message
        debug('Received set switch level to '+level+' for switch Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(message)) {
             debug('Brightness command received but not a number!')
        } else if (!(message >= 0 && message <= 100)) {
            debug('Brightness command receives but out of range (0-100)!')
        } else {
            this.device.setInfo({ device: { v1: { level: level / 100 } } })
        }
    }
}

module.exports = Beam
