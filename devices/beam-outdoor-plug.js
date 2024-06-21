import RingSocketDevice from './base-socket-device.js'
import { RingDeviceType } from 'ring-client-api'

export default class BeamOutdoorPlug extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'lighting')
        this.deviceData.mdl = 'Outdoor Smart Plug'

        this.outlet1 = this.childDevices.find(d => d.deviceType === RingDeviceType.BeamsSwitch && d.data.relToParentZid === "1"),
        this.outlet2 = this.childDevices.find(d => d.deviceType === RingDeviceType.BeamsSwitch && d.data.relToParentZid === "2")

        this.entity.outlet1 = {
            component: (this.outlet1.data.categoryId === 2) ? 'light' : 'switch',
            name: `${this.outlet1.name}`
        }

        this.entity.outlet2 = {
            component: (this.outlet2.data.categoryId === 2) ? 'light' : 'switch',
            name: `${this.outlet2.name}`
        }

        this.outlet1.onData.subscribe(() => {
            if (this.isOnline()) { this.publishOutletState('outlet1') }
        })

        this.outlet2.onData.subscribe(() => {
            if (this.isOnline()) { this.publishOutletState('outlet2') }
        })
    }

    publishState() {
        this.publishOutletState('outlet1')
        this.publishOutletState('outlet2')
        this.publishAttributes()
    }

    publishOutletState(outletId) {
        this.mqttPublish(this.entity[outletId].state_topic, this[outletId].data.on ? "ON" : "OFF")
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        const entityKey = command.split('/')[0]
        switch (command) {
            case 'outlet1/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setOutletState(message, 'outlet1')
                }
                break;
            case 'outlet2/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setOutletState(message, 'outlet2')
                }
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set switch target state on received MQTT command message
    setOutletState(message, outletId) {
        this.debug(`Received set ${outletId} state ${message}`)
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off': {
                const duration = 32767
                const data = Boolean(command === 'on') ? { lightMode: 'on', duration } : { lightMode: 'default' }
                this[outletId].sendCommand('light-mode.set', data)
                break;
            }
            default:
                this.debug(`Received invalid ${outletId} state command`)
        }
    }
}
