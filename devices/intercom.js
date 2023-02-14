import RingPolledDevice from './base-polled-device.js'
import utils from '../lib/utils.js'

export default class Lock extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'intercom')

        this.entity = {
            lock: {
                component: 'lock'
            },
            ding: {
                component: 'binary_sensor',
                attributes: true,
                icon: 'mdi:doorbell'
            },
            info: {
                component: 'sensor',
                device_class: 'timestamp',
                value_template: '{{ value_json["lastUpdate"] | default("") }}'
            }
        }

        this.data = {
            lock: {
                state: 'LOCKED',
                publishedState: null,
                unlockTimeout: false
            },
            ding: {
                state: 'OFF',
                publishedState: null,
                timeout: false
            }
        }

        this.device.onUnlocked.subscribe(() => {
            this.setDoorUnlocked()
        })

        this.device.onDing.subscribe(() => {
            this.processDing()
        })
    }

    async initAttributeEntities() {
        // If device is battery powered publish battery entity
        if (this.device.batteryLevel !== null) {
            this.entity.battery = {
                component: 'sensor',
                device_class: 'battery',
                unit_of_measurement: '%',
                state_class: 'measurement',
                parent_state_topic: 'info/state',
                attributes: 'battery',
                value_template: '{{ value_json["batteryLevel"] | default("") }}'
            }
        }
    }

    publishState(data) {
        const isPublish = data === undefined ? true : false

        this.publishDingState(isPublish)
        this.publishLockState(isPublish)

        if (isPublish) {
            this.publishAttributes()
        }
    }

    publishDingState(isPublish) {
        if (this.data.ding.state !== this.data.ding.publishedState || isPublish) {
            this.mqttPublish(this.entity.ding.state_topic, this.data.ding.state)
            this.data.ding.publishedState = this.data.ding.state
        }
    }

    publishLockState(isPublish) {
        if (this.data.lock.state !== this.data.lock.publishedState || isPublish) {
            this.mqttPublish(this.entity.lock.state_topic, this.data.lock.state)
            this.data.lock.publishedState = this.data.lock.state
        }
    }

    // Publish device data to info topic
    async publishAttributes() {
        const attributes = {
            lastUpdate: Math.floor(Date.now()/1000),
            ...this.device?.batteryLevel
                ? { batteryLevel: this.device.batteryLevel } : {},
            ...this.device.data.hasOwnProperty('firemware_version')
                ? { firmwareVersion: this.device.data.firmware_version } : {}
        }
        this.mqttPublish(this.entity.info.state_topic, JSON.stringify(attributes), 'attr')
        this.publishAttributeEntities(attributes)
    }

    processDing() {
        if (this.data.ding.timeout) {
            clearTimeout(this.data.ding.timeout)
            this.data.ding.timeout = false
        }
        this.data.ding.state = 'ON'
        this.publishDingState()
        this.data.ding.timeout = setTimeout(() => {
            this.data.ding.state = 'OFF'
            this.publishDingState()
            this.data.ding.timeout = false
        }, 15000)
    }

    setDoorUnlocked() {
        if (this.data.lock.unlockTimeout) {
            clearTimeout(this.data.lock.unlockTimeout)
            this.data.lock.unlockTimeout = false
        }
        this.data.lock.state = 'UNLOCKED'
        this.publishLockState()
        this.data.lock.unlockTimeout = setTimeout(() => {
            this.data.lock.state = 'LOCKED'
            this.publishLockState()
            this.data.lock.unlockTimeout = false
        }, 5000)
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
            case 'lock/command':
                this.setLockState(message)
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set lock target state on received MQTT command message
    async setLockState(message) {
        const command = message.toLowerCase()
        switch(command) {
            case 'lock':
                if (this.data.lock.state === 'UNLOCKED') {
                    this.debug('Received lock door command, setting locked state')
                    this.data.lock.state === 'LOCKED'
                    this.publishLockState()
                } else {
                    this.debug('Received lock door command, but door is already locked')
                }
                break;
            case 'unlock':
                this.debug('Received unlock door command, sending unlock command to intercom')
                try {
                    await this.device.unlock()
                    this.debug('Request to unlock door was successful')
                    this.setDoorUnlocked()
                } catch(error) {
                    this.debug(error)
                    this.debug('Request to unlock door failed')
                }
                break;
            default:
                this.debug('Received invalid command for lock')
        }
    }
}