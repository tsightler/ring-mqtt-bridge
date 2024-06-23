#!/usr/bin/env bash
HOME=/app
cd /app
if [ ! -d "/app/ring-mqtt-${BRANCH}" ]; then
    echo "Updating ring-mqtt to the ${BRANCH} version..."
    if [ "${BRANCH}" = "latest" ]; then
        git clone https://github.com/tsightler/ring-mqtt ring-mqtt-latest
    else
        git clone -b dev https://github.com/tsightler/ring-mqtt ring-mqtt-dev
    fi
    cd "/app/ring-mqtt-${BRANCH}"
    echo "Installing node module dependencies, please wait..."
    npm install --no-progress > /dev/null 2>&1
    chmod +x ring-mqtt.js scripts/*.sh

    # This runs the downloaded version of this script in case there are
    # additonal component upgrade actions that need to be performed
    exec "/app/ring-mqtt-${BRANCH}/scripts/update2branch.sh"
    echo "-------------------------------------------------------"
else
    # Branch has already been initialized, run any post-update command here
    echo "The ring-mqtt-${BRANCH} branch has been updated."

    APK_ARCH="$(apk --print-arch)"
    GO2RTC_VERSION="v1.9.4"
    case "${APK_ARCH}" in
        x86_64)
            GO2RTC_ARCH="amd64"
            ;;
        aarch64)
            GO2RTC_ARCH="arm64"
            ;;
        armv7|armhf)
            GO2RTC_ARCH="arm"
            ;;
        *)
            echo >&2 "ERROR: Unsupported architecture '$APK_ARCH'"
            exit 1
            ;;
    esac
    rm -f /usr/local/bin/go2rtc
    curl -L -s -o /usr/local/bin/go2rtc "https://github.com/AlexxIT/go2rtc/releases/download/${GO2RTC_VERSION}/go2rtc_linux_${GO2RTC_ARCH}"
    chmod +x /usr/local/bin/go2rtc

    case "${APK_ARCH}" in
        x86_64)
            apk del npm nodejs
            apk add libstdc++
            cd /opt
            wget https://unofficial-builds.nodejs.org/download/release/v20.14.0/node-v20.14.0-linux-x64-musl.tar.gz
            mkdir nodejs
            tar -zxvf *.tar.gz --directory /opt/nodejs --strip-components=1
            ln -s /opt/nodejs/bin/node /usr/local/bin/node
            ln -s /opt/nodejs/bin/npm /usr/local/bin/npm
            ;;
    esac

    cp -f "/app/ring-mqtt-${BRANCH}/init/s6/services.d/ring-mqtt/run" /etc/services.d/ring-mqtt/run
    chmod +x /etc/services.d/ring-mqtt/run
fi