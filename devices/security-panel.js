import RingSocketDevice from './base-socket-device.js'
import { allAlarmStates, RingDeviceType } from '@tsightler/ring-client-api'
import utils from '../lib/utils.js'
import state from '../lib/state.js'

export default class SecurityPanel extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm', 'alarmState')
        this.deviceData.mdl = 'Alarm Control Panel'
        this.deviceData.name = `${this.device.location.name} Alarm`

        this.bypassCapableDevices = deviceInfo.bypassCapableDevices

        this.data = {
            publishedState: this.ringModeToMqttState(),
            attributes: {
                alarmClearedBy: '',
                alarmClearedTime: '',
                entrySecondsLeft: 0,
                exitSecondsLeft: 0,
                lastArmedBy: 'Unknown',
                lastArmedTime: '',
                lastDisarmedBy: 'Unknown',
                lastDisarmedTime: '',
                targetState: this.ringModeToMqttState(this.device.data.mode),
            }
        }

        this.entity = {
            ...this.entity,
            alarm: {
                component: 'alarm_control_panel',
                attributes: true,
                isMainEntity: true
            },
            siren: {
                component: 'switch',
                icon: 'mdi:alarm-light',
                name: `Siren`
            },
            ...utils.config().enable_panic ? {
                police: {
                    component: 'switch',
                    name: `Panic - Police`,
                    icon: 'mdi:police-badge'
                },
                fire: {
                    component: 'switch',
                    name: `Panic - Fire`,
                    icon: 'mdi:fire'
                }
            } : {}
        }

        this.initAlarmAttributes()

        // Listen to raw data updates for all devices and pick out
        // arm/disarm and countdown events for this security panel
        this.device.location.onDataUpdate.subscribe(async (message) => {
            if (!this.isOnline()) { return }

            if (message.datatype === 'DeviceInfoDocType' &&
                message.body?.[0]?.general?.v2?.zid === this.deviceId &&
                message.body[0].impulse?.v1?.[0] &&
                message.body[0].impulse.v1.filter(i =>
                    i.impulseType.match('security-panel.mode-switched.') ||
                    i.impulseType.match('security-panel.exit-delay') ||
                    i.impulseType.match('security-panel.alarm-cleared')
                ).length > 0
            ) {
                this.processAlarmMode(message)
            }

            if (message.datatype === 'PassthruType' &&
                message.body?.[0]?.zid === this.deviceId &&
                message.body?.[0]?.type === 'security-panel.countdown' &&
                message.body[0]?.data
            ) {
                this.processCountdown(message.body[0].data)
            }
        })
    }

    // Convert Ring alarm modes to Home Asisstan Alarm Control Panel MQTT state
    ringModeToMqttState(mode) {
        // If using actual device mode, return arming/pending/triggered states
        if (!mode) {
            if (this.device.data.mode.match(/some|all/) && (this.device.data?.transitionDelayEndTimestamp - Date.now() > 0)) {
                return 'arming'
            } else if (allAlarmStates.includes(this.device.data.alarmInfo?.state)) {
                return this.device.data.alarmInfo.state === 'entry-delay' ? 'pending' : 'triggered'
            }
        }

        // If mode was passed to the function use it, oterwise use currently active device mode
        switch (mode ? mode : this.device.data.mode) {
            case 'none':
                return 'disarmed'
            case 'some':
                return 'armed_home'
            case 'all':
                return 'armed_away'
            default:
                return 'unknown'
        }
    }

    async initAlarmAttributes() {
        const alarmEvents = await this.device.location.getHistory({ affectedId: this.deviceId })
        const armEvents = alarmEvents.filter(e =>
            Array.isArray(e.body?.[0]?.impulse?.v1) &&
            e.body[0].impulse.v1.filter(i =>
                i.impulseType.match(/security-panel\.mode-switched\.(?:some|all)/)
            ).length > 0
        )
        if (armEvents.length > 0) {
            this.updateAlarmAttributes(armEvents[0], 'Armed')
        }

        const disarmEvents = alarmEvents.filter(e =>
            Array.isArray(e.body?.[0]?.impulse?.v1) &&
            e.body[0].impulse.v1.filter(i =>
                i.impulseType.match(/security-panel\.mode-switched\.none/)
            ).length > 0
        )
        if (disarmEvents.length > 0) {
            this.updateAlarmAttributes(disarmEvents[0], 'Disarmed')
        }
    }

    async updateAlarmAttributes(message, attrPrefix) {
        let initiatingUser = message.context.initiatingEntityName
            ? message.context.initiatingEntityName
            : message.context.initiatingEntityType

        if (message.context.initiatingEntityType === 'user' && message.context.initiatingEntityId) {
            try {
                const userInfo = await this.getUserInfo(message.context.initiatingEntityId)
                if (userInfo) {
                    initiatingUser = `${userInfo.firstName} ${userInfo.lastName}`
                } else {
                    throw new Error('Invalid user information was returned by API')
                }
            } catch (err) {
                this.debug(err.message)
                this.debug('Could not get user information from Ring API')
            }
        }

        this.data.attributes[`${attrPrefix}By`] = initiatingUser
        this.data.attributes[`${attrPrefix}Time`] = message?.context?.eventOccurredTsMs
            ? new Date(message.context.eventOccurredTsMs).toISOString()
            : new Date(now).toISOString()
    }

    async processAlarmMode(message) {
        // Pending and triggered modes are handled by publishState()
        const { impulseType } = message.body[0].impulse.v1.find(i => i.impulseType.match(/some|all|none|exit-delay|alarm-cleared/))
        switch(impulseType.split('.').pop()) {
            case 'some':
            case 'all':
            case 'exit-delay':
                this.data.attributes.targetState = this.ringModeToMqttState() === 'arming'
                    ? this.ringModeToMqttState(this.device.data.mode)
                    : this.ringModeToMqttState()
                await this.updateAlarmAttributes(message, 'lastArmed')
                break;
            case 'alarm-cleared':
                this.data.attributes.targetState = this.ringModeToMqttState()
                await this.updateAlarmAttributes(message, 'alarmCleared')
                break;
            case 'none':
                this.data.attributes.targetState = this.ringModeToMqttState()
                await this.updateAlarmAttributes(message, 'lastDisarmed')
        }
        this.publishAlarmState()
    }

    processCountdown(countdown) {
        if (countdown) {
            if (countdown.transition === 'exit') {
                this.data.attributes.entrySecondsLeft = 0
                this.data.attributes.exitSecondsLeft = countdown.timeLeft
            } else {
                this.data.attributes.entrySecondsLeft = countdown.timeLeft
                this.data.attributes.exitSecondsLeft = 0
            }

            // Suppress attribute publish if countdown event comes before mode switch
            if (this.data.publishedState !== this.data.attributes.targetState) {
                this.publishAlarmAttributes()
            }
        }
    }

    publishState(data) {
        const isPublish = Boolean(data === undefined)

        // Publish alarm states for events not handled by processAlarmMode() as well as
        // any explicit publish requests
        if (this.ringModeToMqttState().match(/pending|triggered/) || isPublish) {
            this.publishAlarmState()
        }

        const sirenState = (this.device.data.siren?.state === 'on') ? 'ON' : 'OFF'
        this.mqttPublish(this.entity.siren.state_topic, sirenState)

        if (utils.config().enable_panic) {
            const policeState = this.device.data.alarmInfo?.state?.match(/burglar|panic/) ? 'ON' : 'OFF'
            if (policeState === 'ON') {
                this.debug('Burglar alarm is triggered for ' + this.device.location.name)
            }
            this.mqttPublish(this.entity.police.state_topic, policeState)

            const fireState = this.device.data.alarmInfo?.state?.match(/co|fire/) ? 'ON' : 'OFF'
            if (fireState === 'ON') {
                this.debug('Fire alarm is triggered for ' + this.device.location.name)
            }
            this.mqttPublish(this.entity.fire.state_topic, fireState)
        }
    }

    publishAlarmState() {
        this.data.publishedState = this.ringModeToMqttState()
        this.mqttPublish(this.entity.alarm.state_topic, this.data.publishedState)
        this.publishAlarmAttributes()
        this.publishAttributes()
    }

    publishAlarmAttributes() {
        // If published state is not a state with a countdown timer, zero out entry/exit times
        if (!this.data.publishedState.match(/arming|pending/)) {
            this.data.attributes.entrySecondsLeft = 0
            this.data.attributes.exitSecondsLeft = 0
        }
        this.mqttPublish(this.entity.alarm.json_attributes_topic, JSON.stringify(this.data.attributes), 'attr')
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        const entityKey = command.split('/')[0]
        switch (command) {
            case 'alarm/command':
                this.setAlarmMode(message)
                break;
            case 'siren/command':
                this.setSirenMode(message)
                break;
            case 'police/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setPoliceMode(message)
                }
                break;
            case 'fire/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setFireMode(message)
                }
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set Alarm Mode on received MQTT command message
    async setAlarmMode(message) {
        this.debug(`Received set alarm mode ${message} for location ${this.device.location.name} (${this.locationId})`)

        // Try to set alarm mode and retry after delay if mode set fails
        // Performing initial arming attempt with no delay
        let retries = 5
        let setAlarmSuccess = false
        while (retries-- > 0 && !(setAlarmSuccess)) {
            let bypassDevices = new Array()

            if (message.toLowerCase() !== 'disarm') {
                // During arming, check for sensors that require bypass
                // Get all devices that allow bypass
                const savedStates = state.getAllSavedStates()

                bypassDevices = this.bypassCapableDevices
                    .filter((device) => {
                        return savedStates[device.id]?.bypass_mode === 'Always' ||
                        (savedStates[device.id]?.bypass_mode === 'Faulted' && device.data.faulted)
                    }).map((d) => {
                        return { name: `${d.name} [${savedStates[d.id].bypass_mode}]`, id: d.id }
                    })

                if (bypassDevices.length > 0) {
                    this.debug(`The following sensors will be bypassed [Reason]: ${bypassDevices.map(d => d.name).join(', ')}`)
                } else {
                    this.debug('No sensors will be bypased')
                }
            }

            setAlarmSuccess = await this.trySetAlarmMode(message, bypassDevices.map(d => d.id))

            // On failure delay 10 seconds for next set attempt
            if (!setAlarmSuccess) { await utils.sleep(10) }
        }

        // Check the return status and print some debugging for failed states
        if (!setAlarmSuccess) {
            this.debug('Alarm could not enter proper arming mode after all retries...Giving up!')
        } else if (setAlarmSuccess == 'unknown') {
            this.debug('Unknown alarm arming mode requested.')
        }
    }

    async trySetAlarmMode(message, bypassDeviceIds) {
        let alarmTargetMode
        this.debug(`Set alarm mode: ${message}`)
        switch(message.toLowerCase()) {
            case 'disarm':
                this.device.location.disarm().catch(err => { this.debug(err) })
                alarmTargetMode = 'none'
                break
            case 'arm_home':
                this.device.location.armHome(bypassDeviceIds).catch(err => { this.debug(err) })
                alarmTargetMode = 'some'
                break
            case 'arm_away':
                this.device.location.armAway(bypassDeviceIds).catch(err => { this.debug(err) })
                alarmTargetMode = 'all'
                break
            default:
                this.debug('Cannot set alarm mode: Unknown')
                return 'unknown'
        }

        // Sleep a few seconds and check if alarm entered requested mode
        await utils.sleep(1);
        if (this.device.data.mode == alarmTargetMode) {
            this.debug(`Alarm for location ${this.device.location.name} successfully entered ${message} mode`)
            return true
        } else {
            this.debug(`Alarm for location ${this.device.location.name} failed to enter requested arm/disarm mode!`)
            return false
        }
    }

    async setSirenMode(message) {
        switch(message.toLowerCase()) {
            case 'on':
                this.debug(`Activating siren for ${this.device.location.name}`)
                this.device.location.soundSiren().catch(err => { this.debug(err) })
                break;
            case 'off': {
                this.debug(`Deactivating siren for ${this.device.location.name}`)
                this.device.location.silenceSiren().catch(err => { this.debug(err) })
                break;
            }
            default:
                this.debug('Received invalid command for siren!')
        }
    }

    async setPoliceMode(message) {
        switch(message.toLowerCase()) {
            case 'on':
                this.debug(`Activating burglar alarm for ${this.device.location.name}`)
                this.device.location.triggerBurglarAlarm().catch(err => { this.debug(err) })
                break;
            case 'off': {
                this.debug(`Deactivating burglar alarm for ${this.device.location.name}`)
                this.device.location.setAlarmMode('none').catch(err => { this.debug(err) })
                break;
            }
            default:
                this.debug('Received invalid command for panic!')
        }
    }

    async setFireMode(message) {
        switch(message.toLowerCase()) {
            case 'on':
                this.debug(`Activating fire alarm for ${this.device.location.name}`)
                this.device.location.triggerFireAlarm().catch(err => { this.debug(err) })
                break;
            case 'off': {
                this.debug(`Deactivating fire alarm for ${this.device.location.name}`)
                this.device.location.setAlarmMode('none').catch(err => { this.debug(err) })
                break;
            }
            default:
                this.debug('Received invalid command for panic!')
        }
    }
}
