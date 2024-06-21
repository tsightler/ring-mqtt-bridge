import RingSocketDevice from './base-socket-device.js'
import { RingDeviceType } from 'ring-client-api'

// Helper functions
function chirpToMqttState(chirp) {
    return chirp.replace('cowbell', 'dinner-bell')
                .replace('none', 'disabled')
                .replace("-", " ")
                .replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())
}

// Main device class
export default class BinarySensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')

        let device_class = false
        let bypass_modes = false
        this.securityPanel = deviceInfo.securityPanel

        // Override icons and and topics
        switch (this.device.deviceType) {
            case RingDeviceType.ContactSensor:
                this.entityName = 'contact'
                this.deviceData.mdl = 'Contact Sensor'
                device_class = (this.device.data.subCategoryId == 2) ? 'window' : 'door'
                bypass_modes = [ 'Never', 'Faulted', 'Always' ]
                break;
            case RingDeviceType.MotionSensor:
                this.entityName = 'motion'
                this.deviceData.mdl = 'Motion Sensor',
                device_class = 'motion'
                bypass_modes = [ 'Never', 'Always' ]
                break;
            case RingDeviceType.RetrofitZone:
                this.entityName = 'zone'
                this.deviceData.mdl = 'Retrofit Zone'
                device_class = 'safety'
                bypass_modes = [ 'Never', 'Faulted', 'Always' ]
                break;
            case RingDeviceType.TiltSensor:
                this.entityName = 'tilt'
                this.deviceData.mdl = 'Tilt Sensor'
                device_class = 'garage_door'
                bypass_modes = [ 'Never', 'Faulted', 'Always' ]
                break;
            case RingDeviceType.GlassbreakSensor:
                this.entityName = 'glassbreak'
                this.deviceData.mdl = 'Glassbreak Sensor'
                device_class = 'safety'
                bypass_modes = [ 'Never', 'Always' ]
                break;
            default:
                delete this.securityPanel
                if (this.device.name.toLowerCase().includes('motion')) {
                    this.entityName = 'motion'
                    this.deviceData.mdl = 'Motion Sensor',
                    device_class = 'motion'
                } else {
                    this.entityName = 'binary_sensor'
                    this.deviceData.mdl = 'Generic Binary Sensor'
                }
        }

        this.entity[this.entityName] = {
            component: 'binary_sensor',
            ...device_class ? { device_class: device_class } : {},
            isMainEntity: true
        }

        // Only official Ring sensors can be bypassed
        if (bypass_modes) {
            const savedState = this.getSavedState()
            this.data = {
                bypass_mode: savedState?.bypass_mode ? savedState.bypass_mode[0].toUpperCase() + savedState.bypass_mode.slice(1) : 'Never',
                published_bypass_mode: false
            }
            this.entity.bypass_mode = {
                component: 'select',
                options: bypass_modes
            }
            this.updateDeviceState()
        }

        if (this?.securityPanel?.data?.chirps?.[this.device.id]?.type) {
            this.data.chirp_tone = chirpToMqttState(this.securityPanel.data.chirps[this.device.id].type)
            this.data.published_chirp_tone = false
            this.entity.chirp_tone = {
                component: 'select',
                options: [
                    'Disabled', 'Ding Dong', 'Harp', 'Navi', 'Wind Chime',
                    'Dinner Bell', 'Echo', 'Ping Pong', 'Siren', 'Sonar', 'Xylophone'
                ]
            }
            this.securityPanel.onData.subscribe(() => {
                if (this?.securityPanel?.data?.chirps?.[this.device.id]?.type) {
                    this.data.chirp_tone = chirpToMqttState(this.securityPanel.data.chirps[this.device.id].type)
                }
                if (this.isOnline()) {
                    this.publishChirpToneState()
                }
            })
        }
    }

    updateDeviceState() {
        const stateData = {
            bypass_mode: this.data.bypass_mode
        }
        this.setSavedState(stateData)
    }

    publishState(data) {
        const isPublish = Boolean(data === undefined)
        const contactState = this.device.data.faulted ? 'ON' : 'OFF'
        this.mqttPublish(this.entity[this.entityName].state_topic, contactState)
        this.publishBypassModeState(isPublish)
        this.publishChirpToneState(isPublish)
        this.publishAttributes()
    }

    publishBypassModeState(isPublish) {
        if (this.entity?.bypass_mode && (this.data.bypass_mode !== this.data.published_bypass_mode || isPublish)) {
            this.mqttPublish(this.entity.bypass_mode.state_topic, this.data.bypass_mode)
            this.data.published_bypass_mode = this.data.bypass_mode
        }
    }

    publishChirpToneState(isPublish) {
        if (this.entity?.chirp_tone && (this.data.chirp_tone !== this.data.published_chirp_tone || isPublish)) {
            this.mqttPublish(this.entity.chirp_tone.state_topic, this.data.chirp_tone)
            this.data.published_chirp_tone = this.data.chirp_tone
        }
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
            case 'bypass_mode/command':
                if (this.entity?.bypass_mode) {
                    this.setBypassMode(message)
                }
                break;
            case 'chirp_tone/command':
                if (this.entity?.chirp_tone) {
                    this.setChirpTone(message)
                }
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set Stream Select Option
    async setBypassMode(message) {
        const mode = message[0].toUpperCase() + message.slice(1)
        if (this.entity.bypass_mode.options.includes(mode)) {
            this.debug(`Received set bypass mode to ${message}`)
            this.data.bypass_mode = mode
            this.publishBypassModeState()
            this.updateDeviceState()
            this.debug(`Bypass mode has been set to ${mode}`)
        } else {
            this.debug(`Received invalid bypass mode for this sensor: ${message}`)
        }
    }

    async setChirpTone(message) {
        this.debug(`Recevied command to set chirp tone ${message}`)
        let chirpTone = this.entity.chirp_tone.options.find(o => o.toLowerCase() === message.toLowerCase())
        if (chirpTone) {
            chirpTone = chirpTone
                .toLowerCase()
                .replace(/\s+/g, "-")
                .replace('dinner-bell', 'cowbell')
                .replace('disabled', 'none')
            this.securityPanel.setInfo({ device: { v1: { chirps: { [this.deviceId]: { type: chirpTone }}}}})
        } else {
            this.debug('Received command to set unknown chirp tone')
        }
    }
}
