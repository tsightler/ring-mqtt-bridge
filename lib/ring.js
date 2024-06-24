import { RingApi, RingDeviceType, RingCamera, RingChime, RingIntercom } from 'ring-client-api'
import chalk from 'chalk'
import utils from './utils.js'
import mediamtx from './mediamtx.js'
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
import RangeExtender from '../devices/range-extender.js'
import SecurityPanel from '../devices/security-panel.js'
import Siren from '../devices/siren.js'
import SmokeAlarm from '../devices/smoke-alarm.js'
import SmokeCoListener from '../devices/smoke-co-listener.js'
import Switch from '../devices/switch.js'
import TemperatureSensor from '../devices/temperature-sensor.js'
import Thermostat from '../devices/thermostat.js'
import debugModule from 'debug'
const debug = debugModule('ring-mqtt')

export default new class RingMqtt {
    constructor() {
        this.locations = new Array()
        this.devices = new Array()
        this.client = false
        this.mqttConnected = false
        this.republishCount = 6 // Republish config/state this many times after startup or HA start/restart
        this.refreshToken = undefined

        // Configure event listeners
        utils.event.on('mqtt_state', async (state) => {
            if (state === 'connected') {
                this.mqttConnected = true
                if (this.locations.length > 0) {
                    debug('MQTT connection re-established, republishing Ring locations...')
                    this.publishLocations()
                } else {
                    debug('MQTT connection established, processing Ring locations...')
                    await this.initRingData()
                    this.publishLocations()
                }
            } else {
                this.mqttConnected = false
            }
        })

        utils.event.on('ha_status', async (topic, message) => {
            debug('Home Assistant state topic '+topic+' received message: '+message)
            if (message === 'online') {
                // Republish devices and state if restart of HA is detected
                if (this.republishCount > 0) {
                    debug('Home Assistant restart detected during existing republish cycle')
                    debug('Resetting device config/state republish count')
                    this.republishCount = 6
                } else {
                    debug('Home Assistant restart detected, resending device config/state in 15 seconds')
                    await utils.sleep(15)
                    this.republishCount = 6
                    this.publishLocations()
                }
            }
        })

        // Check for invalid refreshToken after connection was successfully made
        // This usually indicates a Ring service outage impacting authentication
        setInterval(() => {
            if (this.client && !this.client.restClient.refreshToken) {
                debug(chalk.yellow('Possible Ring service outage detected, forcing use of refresh token from latest state'))
                this.client.restClient.refreshToken = this.refreshToken
                this.client.restClient._authPromise = undefined
            }
        }, 60000)
    }

    async init(state, generatedToken) {
        if (generatedToken) {
            this.refreshToken = generatedToken
            state.updateToken(generatedToken)
        } else {
            this.refreshToken = state.data.ring_token
        }

        if (this.client) {
            try {
                debug('A new refresh token was generated, attempting to re-establish connection to Ring API')
                this.client.restClient.refreshToken = this.refreshToken
                this.client.restClient._authPromise = undefined
                await utils.sleep(2)
                await this.client.getProfile()
                debug(`Successfully re-established connection to Ring API using generated refresh token`)
            } catch (error) {
                debug(chalk.yellowBright(error.message))
                debug(chalk.yellowBright(`Failed to re-establish connection to Ring API using generated refresh token`))
            }
        } else {
            const ringAuth = {
                refreshToken: this.refreshToken,
                systemId: state.data.systemId,
                controlCenterDisplayName: `${process.env.RUNMODE === 'addon' ? 'ring-mqtt-addon' : 'ring-mqtt'}-${state.data.systemId.slice(-5)}`,
                ...utils.config().enable_cameras ? { cameraStatusPollingSeconds: 20 } : {},
                ...utils.config().enable_modes ? { locationModePollingSeconds: 20 } : {},
                ...!(utils.config().location_ids === undefined || utils.config().location_ids == 0) ? { locationIds: utils.config().location_ids } : {}
            }

            try {
                debug(`Attempting connection to Ring API using ${generatedToken ? 'generated' : 'saved'} refresh token...`)
                this.client = new RingApi(ringAuth)
                await utils.sleep(2)
                await this.client.getProfile()
                utils.event.emit('ring_api_state', 'connected')
                debug(`Successfully established connection to Ring API using ${generatedToken ? 'generated' : 'saved'} token`)

                // Subscribe to token update events and save new tokens to state file
                this.client.onRefreshTokenUpdated.subscribe(({ newRefreshToken, oldRefreshToken }) => {
                    if (!oldRefreshToken) {
                        return
                    }
                    debug('Received updated refresh token')
                    this.refreshToken = newRefreshToken
                    state.updateToken(newRefreshToken)
                })
            } catch(error) {
                this.client = false
                debug(chalk.yellowBright(error.message))
                debug(chalk.yellowBright(`Failed to establish connection to Ring API using ${generatedToken ? 'generated' : 'saved'} refresh token`))
            }
        }

        return this.client
    }

    // Update all Ring location/device data
    async initRingData() {
        // Small delay here makes debug output more readable
        await utils.sleep(2)

        // Get all Ring locations
        const locations = await this.client.getLocations()

        debug(chalk.green('-'.repeat(90)))
        debug(chalk.white('This account has access to the following locations:'))
        locations.map(function(location) {
            debug('           '+chalk.green(location.name)+chalk.cyan(` (${location.id})`))
        })
        debug(' '.repeat(90))
        debug(chalk.yellowBright('IMPORTANT: ')+chalk.white('If *ANY* alarm or smart lighting hubs at these locations are *OFFLINE* '))
        debug(chalk.white('           the device discovery process below will hang and no devices will be    '))
        debug(chalk.white('           published!                                                             '))
        debug(' '.repeat(90))
        debug(chalk.white('           If the message "Device Discovery Complete!" is not logged below, please'))
        debug(chalk.white('           carefully check the Ring app for any hubs or smart lighting devices    '))
        debug(chalk.white('           that are in offline state and either remove them from the location or  '))
        debug(chalk.white('           bring them back online prior to restarting ring-mqtt.                  '))
        debug(' '.repeat(90))
        debug(chalk.white('           If desired, the "location_ids" config option can be used to restrict   '))
        debug(chalk.white('           discovery to specific locations. See the documentation for details.    '))
        debug(chalk.green('-'.repeat(90)))
        debug(chalk.white('Starting Device Discovery...'))

        // Loop through each location and update stored locations/devices
        for (const location of locations) {
            let cameras = new Array()
            let chimes = new Array()
            let intercoms = new Array()
            let events = new Array()
            const unsupportedDevices = new Array()

            debug(' '.repeat(90))

            // If new location, set custom properties and add to location list
            if (this.locations.find(l => l.locationId == location.locationId)) {
                debug(chalk.white('Existing location: ')+chalk.green(location.name)+chalk.cyan(` (${location.id})`))
            } else {
                debug(chalk.white('New location: ')+chalk.green(location.name)+chalk.cyan(` (${location.id})`))
                location.isSubscribed = false
                location.isConnected = false
                this.locations.push(location)
            }

            // Get all location devices and, if camera support is enabled, cameras, chimes and intercoms
            const devices = await location.getDevices()

            if (utils.config().enable_cameras) {
                cameras = location.cameras
                chimes = location.chimes
                intercoms = location.intercoms
            }

            if (cameras.length > 0) {
                const cameraIds = (cameras.map(camera => camera.id)).join('%2C')
                try {
                    const response = await location.restClient.request({
                        method: 'GET',
                        url: `https://api.ring.com/evm/v2/history/devices?source_ids=${cameraIds}&capabilities=offline_event&limit=100`
                    })
                    if (Array.isArray(response?.items) && response.items?.length > 0) {
                        events = response.items
                    }
                } catch (err) {
                    debug(err)
                    debug('Failed to retrieve camera event history from Ring API')
                }
            }

            const allDevices = [...devices, ...cameras, ...chimes, ...intercoms]

            // Add modes panel, if configured and the location supports it
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

            // Update Ring devices for location
            for (const device of allDevices) {
                const deviceId = (device instanceof RingCamera || device instanceof RingChime || device instanceof RingIntercom) ? device.data.device_id : device.id
                let foundMessage = '  New device: '
                let ringDevice = this.devices.find(d => d.deviceId === deviceId && d.locationId === location.locationId)
                if (ringDevice) {
                    foundMessage = '  Existing device: '
                } else {
                    ringDevice = await this.getDevice(device, allDevices, events)
                    switch (ringDevice) {
                        case 'not-supported':
                            // Save unsupported device type for log output later
                            unsupportedDevices.push(device.deviceType)
                        case 'ignore':
                            ringDevice=false
                            break
                        default:
                            this.devices.push(ringDevice)
                    }
                }

                if (ringDevice && !ringDevice.hasOwnProperty('parentDevice')) {
                    debug(chalk.white(foundMessage)+chalk.green(`${ringDevice.deviceData.name}`)+chalk.cyan(' ('+ringDevice.deviceId+')'))
                    if (ringDevice?.childDevices) {
                        const indent = ' '.repeat(foundMessage.length-4)
                        debug(chalk.white(`${indent}│   `)+chalk.gray(ringDevice.device.deviceType))
                        let keys = Object.keys(ringDevice.childDevices).length
                        Object.keys(ringDevice.childDevices).forEach(key => {
                            debug(chalk.white(`${indent}${(keys > 1) ? '├─: ' : '└─: '}`)+chalk.green(`${ringDevice.childDevices[key].name}`)+chalk.cyan(` (${ringDevice.childDevices[key].id})`))
                            debug(chalk.white(`${indent}${(keys > 1) ? '│   ' : '    '}`)+chalk.gray(ringDevice.childDevices[key].deviceType))
                            keys--
                        })
                    } else {
                        const indent = ' '.repeat(foundMessage.length)
                        debug(chalk.gray(`${indent}${ringDevice.device.deviceType}`))
                    }
                }
            }
            // Output any unsupported devices to debug with warning
            unsupportedDevices.forEach(deviceType => {
                debug(chalk.yellow(`  Unsupported device: ${deviceType}`))
            })
            await utils.sleep(2)
        }
        await utils.sleep(2)
        debug(' '.repeat(90))
        debug(chalk.white('Device Discovery Complete!'))
        const cameras = await this.devices.filter(d => d.device instanceof RingCamera)
        if (cameras.length > 0 && !mediamtx.started) {
            await mediamtx.init(cameras)
        } else {
            debug(chalk.green('-'.repeat(90)))
        }
        await utils.sleep(3)
    }

    // Return supported device
    async getDevice(device, allDevices, events) {
        const deviceInfo = {
            device: device,
            ...allDevices.filter(d => d.data.parentZid === device.id).length
                ? { childDevices: allDevices.filter(d => d.data.parentZid === device.id) } : {},
            ...(device.data && device.data.hasOwnProperty('parentZid'))
                ? { parentDevice: allDevices.find(d => d.id === device.data.parentZid) } : {}
        }
        if (device instanceof RingCamera) {
            return new Camera(deviceInfo, events.filter(event => event.source_id === device.id.toString()))
        } else if (device instanceof RingChime) {
            return new Chime(deviceInfo)
        } else if (device instanceof RingIntercom) {
            return new Intercom(deviceInfo)
        } else if (/^lock($|\.)/.test(device.deviceType)) {
            return new Lock(deviceInfo)
        }
        switch (device.deviceType) {
            case RingDeviceType.ContactSensor:
            case RingDeviceType.RetrofitZone:
            case RingDeviceType.TiltSensor:
            case RingDeviceType.GlassbreakSensor:
            case RingDeviceType.MotionSensor:
            case RingDeviceType.Sensor:
                deviceInfo.securityPanel = allDevices.find(device =>
                    device.deviceType === RingDeviceType.SecurityPanel
                )
                return new BinarySensor(deviceInfo)
            case RingDeviceType.FloodFreezeSensor:
                return new FloodFreezeSensor(deviceInfo)
            case RingDeviceType.SecurityPanel:
                deviceInfo.bypassCapableDevices = allDevices.filter(device =>
                    device.deviceType === RingDeviceType.ContactSensor ||
                    device.deviceType === RingDeviceType.RetrofitZone ||
                    device.deviceType === RingDeviceType.MotionSensor ||
                    device.deviceType === RingDeviceType.TiltSensor ||
                    device.deviceType === RingDeviceType.GlassbreakSensor
                )
                return new SecurityPanel(deviceInfo)
            case RingDeviceType.SmokeAlarm:
                return new SmokeAlarm(deviceInfo)
            case RingDeviceType.CoAlarm:
                return new CoAlarm(deviceInfo)
            case RingDeviceType.SmokeCoListener:
                return new SmokeCoListener(deviceInfo)
            case RingDeviceType.BeamsMotionSensor:
            case RingDeviceType.BeamsMultiLevelSwitch:
            case RingDeviceType.BeamsTransformerSwitch:
            case RingDeviceType.BeamsLightGroupSwitch:
                return new Beam(deviceInfo)
            case RingDeviceType.BeamsDevice:
                return new BeamOutdoorPlug(deviceInfo)
            case RingDeviceType.MultiLevelSwitch:
                return device.categoryId === 17 ? new Fan(deviceInfo) : new MultiLevelSwitch(deviceInfo)
            case RingDeviceType.Switch:
                return new Switch(deviceInfo)
            case RingDeviceType.Keypad:
                return new Keypad(deviceInfo)
            case RingDeviceType.BaseStation:
                return new BaseStation(deviceInfo)
            case RingDeviceType.RangeExtender:
                return new RangeExtender(deviceInfo)
            case RingDeviceType.RingNetAdapter:
                // For some reason some locations have devices of type "ringnet" that are not real
                // so this filters devices with hidden tag to try to elimnate these phantom devices
                return device.tags?.includes('hidden') ? 'ignore' : new Bridge(deviceInfo)
            case 'location.mode':
                return new ModesPanel(deviceInfo)
            case 'siren':
            case 'siren.outdoor-strobe':
                return new Siren(deviceInfo)
            case RingDeviceType.Thermostat:
                return new Thermostat(deviceInfo)
            case RingDeviceType.TemperatureSensor:
                if (deviceInfo.hasOwnProperty('parentDevice') && deviceInfo.parentDevice.deviceType === RingDeviceType.Thermostat) {
                    return 'ignore'
                } else {
                    return new TemperatureSensor(deviceInfo)
                }
            case RingDeviceType.BeamsSwitch:
            case 'access-code':
            case 'access-code.vault':
            case 'adapter.sidewalk':
            case 'adapter.zigbee':
            case 'adapter.zwave':
            case 'thermostat-operating-status':
                return "ignore"
        }
        return "not-supported"
    }

    // Loop through each location and publish supported devices
    async publishLocations() {
        // For each location get existing alarm & camera devices
        this.locations.forEach(async location => {
            const devices = await this.devices.filter(d => d.locationId == location.locationId)
            // If location has devices publish them
            if (devices && devices.length) {
                if (location.hasHubs && !location.isSubscribed) {
                    // Location has an alarm or smart bridge so subscribe to websocket connection monitor
                    location.isSubscribed = true
                    location.onConnected.subscribe(async connected => {
                        if (connected) {
                            // Only publish if previous state was actually disconnected
                            if (!location.isConnected) {
                                location.isConnected = true
                                debug(`Websocket for location id ${location.locationId} is connected`)
                                this.publishDevices(location)
                            }
                        } else {
                            // Wait 30 seconds before setting devices offline in case disconnect is transient
                            // Keeps from creating "unknown" state for sensors if connection error is short lived
                            await utils.sleep(30)
                            if (!location.onConnected._value) {
                                location.isConnected = false
                                debug(`Websocket for location id ${location.locationId} is disconnected`)
                                this.devices.forEach(device => {
                                    if (device.locationId == location.locationId && !device.camera) {
                                        device.offline()
                                    }
                                })
                            }
                        }
                    })
                } else {
                    this.publishDevices(location)
                }
            } else {
                debug(`No devices found for location ID ${location.id}`)
            }
        })
    }

    // Publish devices/cameras for given location
    async publishDevices(location) {
        this.republishCount = (this.republishCount < 1) ? 1 : this.republishCount
        while (this.republishCount > 0 && this.mqttConnected) {
            try {
                const devices = await this.devices.filter(d => d.locationId == location.locationId)
                if (devices && devices.length) {
                    devices.forEach(device => {
                        // Provide location websocket connection state to device
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

    async mediamtxShutdown() {
        await mediamtx.shutdown()
    }
}
