import { RingApi, RingDeviceType, RingCamera, RingChime, RingIntercom } from 'ring-client-api'
import { BehaviorSubject } from 'rxjs'
import { distinctUntilChanged } from 'rxjs/operators'
import chalk from 'chalk'
import debugModule from 'debug'
import utils from './utils.js'
import go2rtc from './go2rtc.js'
import BaseStation from '../devices/base-station.js'
import Beam from '../devices/beam.js'
import BeamOutdoorPlug from '../devices/beam-outdoor-plug.js'
import BinarySensor from '../devices/binary-sensor.js'
import Bridge from '../devices/bridge.js'
import Camera from '../devices/camera.js'
import CoAlarm from '../devices/co-alarm.js'
import Chime from '../devices/chime.js'
import Fan from '../devices/fan.js'
import FloodFreezeSensor from '../devices/flood-freeze-sensor.js'
import Intercom from '../devices/intercom.js'
import Keypad from '../devices/keypad.js'
import Lock from '../devices/lock.js'
import ModesPanel from '../devices/modes-panel.js'
import MultiLevelSwitch from '../devices/multi-level-switch.js'
import PanicButton from '../devices/panic-button.js'
import RangeExtender from '../devices/range-extender.js'
import SecurityPanel from '../devices/security-panel.js'
import Siren from '../devices/siren.js'
import SmokeAlarm from '../devices/smoke-alarm.js'
import SmokeCoListener from '../devices/smoke-co-listener.js'
import Switch from '../devices/switch.js'
import TemperatureSensor from '../devices/temperature-sensor.js'
import Thermostat from '../devices/thermostat.js'
import Valve from '../devices/valve.js'

const debug = debugModule('ring-mqtt')

export default new class RingMqtt {
    constructor() {
        this.locations$ = new BehaviorSubject([])
        this.devices$ = new BehaviorSubject([])
        this.mqttConnected$ = new BehaviorSubject(false)
        this.client = null
        this.refreshToken = undefined
        this.republishCount = 6

        this.setupSubscriptions()
        this.setupRefreshTokenCheck()
    }

    setupSubscriptions() {
        utils.event.on('mqtt_state', state => {
            this.mqttConnected$.next(state === 'connected')
        })

        this.mqttConnected$.pipe(
            distinctUntilChanged()
        ).subscribe(async connected => {
            if (connected) {
                await this.handleMqttConnection()
            }
        })

        utils.event.on('ha_status', async (topic, message) => {
            debug('Home Assistant state topic '+topic+' received message: '+message)
            if (message === 'online') {
                await this.handleHomeAssistantRestart()
            }
        })
    }

    setupRefreshTokenCheck() {
        setInterval(() => {
            if (this.client && !this.client.restClient.refreshToken) {
                debug(chalk.yellow('Possible Ring service outage detected, forcing use of refresh token from latest state'))
                this.client.restClient.refreshToken = this.refreshToken
                this.client.restClient._authPromise = undefined
            }
        }, 60000)
    }

    async init(state, generatedToken) {
        this.refreshToken = generatedToken || state.data.ring_token

        if (this.client) {
            return this.reestablishConnection()
        }

        const ringAuth = this.buildRingAuth(state)

        try {
            debug(`Attempting connection to Ring API using ${generatedToken ? 'generated' : 'saved'} refresh token...`)
            this.client = new RingApi(ringAuth)
            await utils.sleep(2)
            await this.client.getProfile()

            utils.event.emit('ring_api_state', 'connected')
            debug(`Successfully established connection to Ring API`)

            this.setupTokenUpdates(state)
            return this.client
        } catch (error) {
            this.client = null
            debug(chalk.yellowBright(error.message))
            debug(chalk.yellowBright(`Failed to establish connection to Ring API`))
            return false
        }
    }

    buildRingAuth(state) {
        return {
            refreshToken: this.refreshToken,
            systemId: state.data.systemId,
            controlCenterDisplayName: `${process.env.RUNMODE === 'addon' ? 'ring-mqtt-addon' : 'ring-mqtt'}-${state.data.systemId.slice(-5)}`,
            ...utils.config().enable_cameras ? { cameraStatusPollingSeconds: 20 } : {},
            ...utils.config().enable_modes ? { locationModePollingSeconds: 20 } : {},
            ...!(utils.config().location_ids === undefined || utils.config().location_ids == 0)
                ? { locationIds: utils.config().location_ids }
                : {}
        }
    }

    async handleMqttConnection() {
        const locations = this.locations$.value
        if (locations.length > 0) {
            debug('MQTT connection re-established, republishing Ring locations...')
            await this.publishLocations()
        } else {
            debug('MQTT connection established, processing Ring locations...')
            await this.initRingData()
            await this.publishLocations()
        }
    }

    async handleHomeAssistantRestart() {
        if (this.republishCount > 0) {
            debug('Home Assistant restart detected during existing republish cycle')
            this.republishCount = 6
        } else {
            debug('Home Assistant restart detected, resending device config/state in 15 seconds')
            await utils.sleep(15)
            this.republishCount = 6
            await this.publishLocations()
        }
    }

    async initRingData() {
        await utils.sleep(2)
        const locations = await this.client.getLocations()

        this.logLocationInfo(locations)

        for (const location of locations) {
            await this.processLocation(location)
        }

        const cameras = this.devices$.value.filter(d => d.device instanceof RingCamera)
        if (cameras.length > 0 && !go2rtc.started) {
            await go2rtc.init(cameras)
        }
        await utils.sleep(3)
    }

    async processLocation(location) {
        const existingLocation = this.locations$.value.find(l => l.locationId === location.locationId)

        if (!existingLocation) {
            location.isSubscribed = false
            location.isConnected = false
            this.locations$.next([...this.locations$.value, location])
        }

        const devices = await this.getLocationDevices(location)
        await this.processDevices(location, devices)
    }

    async getLocationDevices(location) {
        const devices = await location.getDevices()
        const cameras = utils.config().enable_cameras ? location.cameras : []
        const chimes = utils.config().enable_cameras ? location.chimes : []
        const intercoms = utils.config().enable_cameras ? location.intercoms : []
        const events = await this.getCameraEvents(location, cameras)

        return { devices, cameras, chimes, intercoms, events }
    }

    async getCameraEvents(location, cameras) {
        if (!cameras.length) return []

        try {
            const cameraIds = cameras.map(camera => camera.id).join('%2C')
            const response = await location.restClient.request({
                method: 'GET',
                url: `https://api.ring.com/evm/v2/history/devices?source_ids=${cameraIds}&capabilities=offline_event&limit=100`
            })
            return Array.isArray(response?.items) ? response.items : []
        } catch {
            debug('Failed to retrieve camera event history from Ring API')
            return []
        }
    }

    async processDevices(location, { devices, cameras, chimes, intercoms, events }) {
        const allDevices = [...devices, ...cameras, ...chimes, ...intercoms]

        if (utils.config().enable_modes && (await location.supportsLocationModeSwitching())) {
            allDevices.push({
                deviceType: 'location.mode',
                location: location,
                id: location.locationId + '_mode',
                onData: location.onLocationMode,
                data: {
                    device_id: location.locationId + '_mode',
                    location_id: location.locationId
                }
            })
        }

        const unsupportedDevices = []
        for (const device of allDevices) {
            const deviceId = this.getDeviceId(device)
            const existingDevice = this.devices$.value.find(d => d.deviceId === deviceId)

            if (!existingDevice) {
                const mappedDevice = await DeviceMapper.mapDevice(device, allDevices, events)
                if (mappedDevice === 'not-supported') {
                    unsupportedDevices.push(device.deviceType)
                } else if (mappedDevice && mappedDevice !== 'ignore') {
                    this.devices$.next([...this.devices$.value, mappedDevice])
                    this.logNewDevice(mappedDevice)
                }
            } else {
                this.logExistingDevice(existingDevice)
            }
        }

        unsupportedDevices.forEach(deviceType => {
            debug(chalk.yellow(`  Unsupported device: ${deviceType}`))
        })
    }

    getDeviceId(device) {
        return (device instanceof RingCamera ||
                device instanceof RingChime ||
                device instanceof RingIntercom)
            ? device.data.device_id
            : device.id
    }

    logNewDevice(device) {
        if (!device?.hasOwnProperty('parentDevice')) {
            this.logDeviceDetails(device, '  New device: ')
        }
    }

    logExistingDevice(device) {
        if (!device?.hasOwnProperty('parentDevice')) {
            this.logDeviceDetails(device, '  Existing device: ')
        }
    }

    logLocationInfo(locations) {
        debug(chalk.green('-'.repeat(90)))
        debug(chalk.white('This account has access to the following locations:'))
        locations.forEach(location => {
            debug('           '+chalk.green(location.name)+chalk.cyan(` (${location.id})`))
        })
        debug(' '.repeat(90))
        debug(chalk.yellowBright('IMPORTANT: ')+chalk.white('If any alarm or smart lighting hubs for a location are in any state other      '))
        debug(chalk.white('           than *ONLINE*, including *OFFLINE* or *CELL BACKUP*, device discovery will     '))
        debug(chalk.white('           hang and no devices will be published until the hub returns to *ONLINE* state. '))
        debug(' '.repeat(90))
        debug(chalk.white('           If desired, the "location_ids" config option can be used to restrict           '))
        debug(chalk.white('           discovery to specific locations. See the documentation for details.            '))
        debug(chalk.green('-'.repeat(90)))
        debug(chalk.white('Starting Device Discovery...'))
    }

    logDeviceDetails(device, prefix) {
        debug(chalk.white(prefix) +
              chalk.green(`${device.deviceData.name}`) +
              chalk.cyan(` (${device.deviceId})`))

        if (device?.childDevices) {
            const indent = ' '.repeat(prefix.length - 4)
            debug(chalk.white(`${indent}│   `) + chalk.gray(device.device.deviceType))

            let keys = Object.keys(device.childDevices).length
            Object.keys(device.childDevices).forEach(key => {
                const childDevice = device.childDevices[key]
                debug(chalk.white(`${indent}${(keys > 1) ? '├─: ' : '└─: '}`) +
                      chalk.green(`${childDevice.name}`) +
                      chalk.cyan(` (${childDevice.id})`))
                debug(chalk.white(`${indent}${(keys > 1) ? '│   ' : '    '}`) +
                      chalk.gray(childDevice.deviceType))
                keys--
            })
        } else {
            const indent = ' '.repeat(prefix.length)
            debug(chalk.gray(`${indent}${device.device.deviceType}`))
        }
    }

    async publishLocations() {
        for (const location of this.locations$.value) {
            const devices = this.devices$.value.filter(d => d.locationId === location.locationId)
            if (devices.length) {
                if (location.hasHubs && !location.isSubscribed) {
                    this.subscribeToLocationWebsocket(location)
                } else {
                    await this.publishDevices(location)
                }
            }
        }
    }

    subscribeToLocationWebsocket(location) {
        location.isSubscribed = true
        location.onConnected.subscribe(async connected => {
            if (connected && !location.isConnected) {
                location.isConnected = true
                debug(`Websocket for location id ${location.locationId} is connected`)
                await this.publishDevices(location)
            } else if (!connected) {
                await utils.sleep(30)
                if (!location.onConnected._value) {
                    location.isConnected = false
                    debug(`Websocket for location id ${location.locationId} is disconnected`)
                    this.handleLocationDisconnect(location)
                }
            }
        })
    }

    handleLocationDisconnect(location) {
        const locationDevices = this.devices$.value
            .filter(device => device.locationId === location.locationId && !device.camera)
        locationDevices.forEach(device => device.offline())
    }

    async publishDevices(location) {
        while (this.republishCount > 0 && this.mqttConnected$.value) {
            try {
                const devices = this.devices$.value.filter(d => d.locationId === location.locationId)
                if (devices && devices.length) {
                    devices.forEach(device => {
                        device.publish(location.onConnected._value)
                    })
                }
            } catch (error) {
                debug(error)
            }
            await utils.sleep(30)
            this.republishCount--
        }
    }

    setupTokenUpdates(state) {
        this.client.onRefreshTokenUpdated.subscribe(({ newRefreshToken, oldRefreshToken }) => {
            if (!oldRefreshToken) return
            debug('Received updated refresh token')
            this.refreshToken = newRefreshToken
            state.updateToken(newRefreshToken)
        })
    }

    async reestablishConnection() {
        try {
            debug('Attempting to re-establish connection to Ring API using generated refresh token')
            this.client.restClient.refreshToken = this.refreshToken
            this.client.restClient._authPromise = undefined
            await utils.sleep(2)
            await this.client.getProfile()
            debug('Successfully re-established connection to Ring API using generated refresh token')
            return this.client
        } catch (error) {
            debug(chalk.yellowBright(error.message))
            debug(chalk.yellowBright('Failed to re-establish connection to Ring API using generated refresh token'))
            return false
        }
    }

    async shutdown() {
        await go2rtc.shutdown()
        if (this.devices$.value.length > 0) {
            debug('Setting all devices offline...')
            await utils.sleep(1)
            this.devices$.value.forEach(ringDevice => {
                if (ringDevice.availabilityState === 'online') {
                    ringDevice.shutdown = true
                    ringDevice.offline()
                }
            })
        }
    }
}

class DeviceMapper {
    static async mapDevice(device, allDevices, events) {
        const deviceInfo = this.buildDeviceInfo(device, allDevices)

        if (device instanceof RingCamera) return new Camera(deviceInfo, this.filterDeviceEvents(device, events))
        if (device instanceof RingChime) return new Chime(deviceInfo)
        if (device instanceof RingIntercom) return new Intercom(deviceInfo)

        return this.mapByDeviceType(device, deviceInfo, allDevices)
    }

    static buildDeviceInfo(device, allDevices) {
        return {
            device,
            ...(this.hasChildDevices(device, allDevices) && {
                childDevices: allDevices.filter(d => d.data.parentZid === device.id)
            }),
            ...(device.data?.hasOwnProperty('parentZid') && {
                parentDevice: allDevices.find(d => d.id === device.data.parentZid)
            })
        }
    }

    static hasChildDevices(device, allDevices) {
        return allDevices.some(d => d.data.parentZid === device.id)
    }

    static filterDeviceEvents(device, events) {
        return events.filter(event => event.source_id === device.id.toString())
    }

    static mapByDeviceType(device, deviceInfo, allDevices) {
        const creators = {
            // Security sensors
            [RingDeviceType.SecurityPanel]: () => {
                deviceInfo.bypassCapableDevices = this.getBypassCapableDevices(allDevices)
                return new SecurityPanel(deviceInfo)
            },
            [RingDeviceType.ContactSensor]: () => this.createSecurityDevice(deviceInfo, allDevices),
            [RingDeviceType.RetrofitZone]: () => this.createSecurityDevice(deviceInfo, allDevices),
            [RingDeviceType.TiltSensor]: () => this.createSecurityDevice(deviceInfo, allDevices),
            [RingDeviceType.GlassbreakSensor]: () => this.createSecurityDevice(deviceInfo, allDevices),
            [RingDeviceType.MotionSensor]: () => this.createSecurityDevice(deviceInfo, allDevices),
            [RingDeviceType.Sensor]: () => this.createSecurityDevice(deviceInfo, allDevices),

            // Environmental sensors
            [RingDeviceType.FloodFreezeSensor]: () => new FloodFreezeSensor(deviceInfo),
            [RingDeviceType.SmokeAlarm]: () => new SmokeAlarm(deviceInfo),
            [RingDeviceType.CoAlarm]: () => new CoAlarm(deviceInfo),
            [RingDeviceType.SmokeCoListener]: () => new SmokeCoListener(deviceInfo),
            [RingDeviceType.TemperatureSensor]: () => this.handleTemperatureSensor(deviceInfo),

            // Ring Smart Lighting devices
            [RingDeviceType.BeamsMotionSensor]: () => new Beam(deviceInfo),
            [RingDeviceType.BeamsDevice]: () => new BeamOutdoorPlug(deviceInfo),
            [RingDeviceType.BeamsMultiLevelSwitch]: () => new Beam(deviceInfo),
            [RingDeviceType.BeamsTransformerSwitch]: () => new Beam(deviceInfo),
            [RingDeviceType.BeamsLightGroupSwitch]: () => new Beam(deviceInfo),

            // Switches and controls
            [RingDeviceType.Switch]: () => new Switch(deviceInfo),
            [RingDeviceType.MultiLevelSwitch]: () =>
                device.categoryId === 17 ? new Fan(deviceInfo) : new MultiLevelSwitch(deviceInfo),
            [RingDeviceType.Thermostat]: () => new Thermostat(deviceInfo),
            [RingDeviceType.WaterValve]: () => new Valve(deviceInfo),

            // Base station and network devices
            [RingDeviceType.BaseStation]: () => new BaseStation(deviceInfo),
            [RingDeviceType.RangeExtender]: () => new RangeExtender(deviceInfo),
            [RingDeviceType.RingNetAdapter]: () =>
                device.tags?.includes('hidden') ? 'ignore' : new Bridge(deviceInfo),

            // Input devices
            [RingDeviceType.Keypad]: () => new Keypad(deviceInfo),
            'security-remote': () => new PanicButton(deviceInfo),

            // Locks
            get lock() {
                return (device.deviceType.startsWith('lock.') || device.deviceType === 'lock')
                    ? () => new Lock(deviceInfo)
                    : undefined
            },

            // Location mode and sirens
            'location.mode': () => new ModesPanel(deviceInfo),
            'siren': () => new Siren(deviceInfo),
            'siren.outdoor-strobe': () => new Siren(deviceInfo),

            // Ignored devices
            [RingDeviceType.BeamsSwitch]: () => 'ignore',
            'access-code': () => 'ignore',
            'access-code.vault': () => 'ignore',
            'adapter.sidewalk': () => 'ignore',
            'adapter.shadow': () => 'ignore',
            'adapter.zigbee': () => 'ignore',
            'adapter.zwave': () => 'ignore',
            'thermostat-operating-status': () => 'ignore',
        }

        const deviceCreator = creators[device.deviceType] || creators.lock
        return deviceCreator ? deviceCreator() : "not-supported"
    }

    static createSecurityDevice(deviceInfo, allDevices) {
        deviceInfo.securityPanel = allDevices.find(device =>
            device.deviceType === RingDeviceType.SecurityPanel
        )
        return new BinarySensor(deviceInfo)
    }

    static handleTemperatureSensor(deviceInfo) {
        if (deviceInfo.hasOwnProperty('parentDevice') &&
            deviceInfo.parentDevice.deviceType === RingDeviceType.Thermostat) {
            return 'ignore'
        }
        return new TemperatureSensor(deviceInfo)
    }

    static getBypassCapableDevices(allDevices) {
        const bypassableTypes = [
            RingDeviceType.ContactSensor,
            RingDeviceType.RetrofitZone,
            RingDeviceType.MotionSensor,
            RingDeviceType.TiltSensor,
            RingDeviceType.GlassbreakSensor
        ]
        return allDevices.filter(device => bypassableTypes.includes(device.deviceType))
    }
}