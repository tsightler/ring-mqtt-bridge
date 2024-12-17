export const webTemplate = `<!DOCTYPE html>
<html>
<head>
    <title>Ring-MQTT Authenticator</title>
    <style>
        :root {
            /* Light theme variables */
            --bg-color: #f5f5f5;
            --container-bg: #fff;
            --text-color: #212529;
            --header-bg: #2f95c8;
            --header-color: #ffffff;
            --input-bg: #fff;
            --input-color: #495057;
            --input-border: #ced4da;
            --instruction-color: #6c757d;
            --error-bg: #f8d7da;
            --error-color: #721c24;
            --error-border: #f5c6cb;
            --success-bg: #e8f5ee;
            --success-color: #006400;
            --success-border: #c6e6d5;
            --button-primary-bg: #2f95c8;
            --button-primary-border: #2784b3;
            --button-secondary-bg: #6c757d;
            --button-secondary-border: #6c757d;
            --device-name-color: #00cc00;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --bg-color: #1a1a1a;
                --container-bg: #2d2d2d;
                --text-color: #e0e0e0;
                --header-bg: #1e5c7c;
                --header-color: #ffffff;
                --input-bg: #3d3d3d;
                --input-color: #e0e0e0;
                --input-border: #4d4d4d;
                --instruction-color: #a0a0a0;
                --error-bg: #442326;
                --error-color: #ff9999;
                --error-border: #662629;
                --success-bg: #1e3323;
                --success-color: #90ee90;
                --success-border: #2d4d33;
                --button-primary-bg: #1e5c7c;
                --button-primary-border: #164459;
                --button-secondary-bg: #4d4d4d;
                --button-secondary-border: #404040;
                --device-name-color: #66ff66;
            }
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.5;
            margin: 0;
            background-color: var(--bg-color);
            color: var(--text-color);
        }

        h1 {
            font-size: 1.75rem;
            font-weight: bold;
            text-align: center;
            margin-bottom: 0.75rem;
            color: var(--header-color);
            background-color: var(--header-bg);
            padding: 0.75rem;
            border-radius: 0.25rem;
        }

        .hidden {
            display: none;
        }

        .error {
            color: var(--error-color);
            background-color: var(--error-bg);
            border: 1px solid var(--error-border);
            border-radius: 0.25rem;
            padding: 0.75rem 1.25rem;
            margin-top: 1rem;
            opacity: 1;
            transition: opacity 0.5s ease-in-out;
        }

        .fade-out {
            opacity: 0;
        }

        .container {
            max-width: 500px;
            margin: 1rem auto;
            padding: 1.5rem;
            background-color: var(--container-bg);
            border: 1px solid rgba(0,0,0,.125);
            border-radius: 0.25rem;
            box-shadow: 0 0.125rem 0.25rem rgba(0,0,0,.075);
        }

        .form-group {
            margin-bottom: 1rem;
        }

        .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 500;
        }

        .instruction {
            text-align: center;
            color: var(--instruction-color);
            margin-bottom: .75rem;
            font-weight: bold;
        }

        input {
            width: 100%;
            padding: 0.375rem 0.75rem;
            font-size: 1rem;
            line-height: 1.5;
            color: var(--input-color);
            background-color: var(--input-bg);
            border: 1px solid var(--input-border);
            border-radius: 0.25rem;
            transition: border-color .15s ease-in-out,box-shadow .15s ease-in-out;
            margin-top: 0.25rem;
            box-sizing: border-box;
        }

        input:focus {
            color: var(--input-color);
            background-color: var(--input-bg);
            border-color: #80bdff;
            outline: 0;
            box-shadow: 0 0 0 0.2rem rgba(0,123,255,.25);
        }

        button {
            width: 100%;
            padding: 0.5rem 1rem;
            font-size: 1rem;
            line-height: 1.5;
            border-radius: 0.25rem;
            color: var(--header-color);
            background-color: var(--button-primary-bg);
            border: 1px solid var(--button-primary-border);
            cursor: pointer;
            transition: color .15s ease-in-out,background-color .15s ease-in-out,border-color .15s ease-in-out,box-shadow .15s ease-in-out;
        }

        button:hover {
            color: var(--header-color);
            background-color: #2680b0;
            border-color: #206d94;
        }

        button:focus {
            box-shadow: 0 0 0 0.2rem rgba(47,149,200,.5);
            outline: 0;
        }

        .button-group {
            display: flex;
            gap: 1rem;
            width: 100%;
        }

        .button-group button {
            padding: 0.5rem 1rem;
            font-size: 1rem;
            line-height: 1.5;
            border-radius: 0.25rem;
            color: var(--header-color);
            cursor: pointer;
            transition: color .15s ease-in-out,background-color .15s ease-in-out,border-color .15s ease-in-out,box-shadow .15s ease-in-out;
        }

        .button-group .back-button {
            flex: 0 0 auto;
            width: auto;
            background-color: var(--button-secondary-bg);
            border-color: var(--button-secondary-border);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .back-arrow {
            display: inline-block;
            width: 0.6em;
            height: 0.6em;
            border-left: 0.2em solid currentColor;
            border-bottom: 0.2em solid currentColor;
            transform: rotate(45deg);
            margin-right: 0.2em;
            position: relative;
            top: -0.1em;
        }

        .button-group .submit-button {
            flex: 1;
            background-color: var(--button-primary-bg);
            border-color: var(--button-primary-border);
        }

        .back-button:hover {
            background-color: #5a6268;
            border-color: #545b62;
        }

        .back-button:focus {
            box-shadow: 0 0 0 0.2rem rgba(108,117,125,.5);
        }

        .submit-button:hover {
            background-color: #2680b0;
            border-color: #206d94;
        }

        .submit-button:focus {
            box-shadow: 0 0 0 0.2rem rgba(47,149,200,.5);
        }

        #togglePassword {
            width: auto;
            position: absolute;
            right: 5px;
            top: 50%;
            transform: translateY(-44%);
            padding: 2px 6px;
            font-size: 0.875rem;
            color: var(--header-color);
            background-color: var(--button-primary-bg);
            border: 1px solid var(--button-primary-border);
            border-radius: 0.25rem;
            cursor: pointer;
            transition: color .15s ease-in-out,background-color .15s ease-in-out,border-color .15s ease-in-out,box-shadow .15s ease-in-out;
        }

        #togglePassword:hover {
            background-color: #2680b0;
            border-color: #206d94;
        }

        #togglePassword:focus {
            box-shadow: 0 0 0 0.2rem rgba(0,123,255,.5);
            outline: 0;
        }

        .password-container {
            position: relative;
        }

        .password-container input {
            padding-right: 85px;
        }

        #displayName {
            color: var(--instruction-color);
            text-align: center;
            margin-bottom: .75rem;
            font-weight: bold;
            font-size: 1rem;
        }

        .device-name {
            color: var(--device-name-color);
            font-weight: bold;
            font-size: 1.1rem;
        }

        .message {
            color: var(--success-color);
            background-color: var(--success-bg);
            border: 1px solid var(--success-border);
            border-radius: 0.25rem;
            padding: 0.75rem 1.25rem;
            margin-top: 1rem;
            opacity: 1;
            transition: opacity 0.5s ease-in-out;
        }

        #connectedMessage .message:last-child {
            margin-bottom: 1.5rem;
        }

        #reauth {
            margin-top: 1rem;
        }

        @media (max-width: 576px) {
            .container {
                margin: 1rem;
                padding: 1rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1 id="title">Ring-MQTT Authenticator</h1>
        <p class="instruction">Authenticate ring-mqtt to a Ring account</p>
        <div id="displayName"></div>

        <div id="successMessage" class="hidden">
            <p class="message">Authentication with Ring was successful and <strong>ring-mqtt</strong> will now attempt to connect to Ring servers.  No additional steps are required, please review the ring-mqtt logs to monitor progress.</p>
        </div>

        <div id="connectedMessage" class="hidden">
            <p class="message">This <strong>ring-mqtt</strong> instance is already authenticated to a Ring account.</p>
        </div>

        <div id="reauthMessage" class="hidden">
            <p class="message">To force reauthentication, for example, to switch the account in use, click the button below.</p>
            <button id="reauth">Force Reauthentication</button>
        </div>

        <form id="loginForm" class="hidden">
            <div class="form-group">
                <label>Email Address</label>
                <input type="email" id="email" name="email" required>
            </div>
            <div class="form-group">
                <label>Password</label>
                <div class="password-container">
                    <input type="password" id="password" name="password" required>
                    <button type="button" id="togglePassword">Show</button>
                </div>
            </div>
            <button type="submit">Submit</button>
        </form>

        <form id="twoFactorForm" class="hidden">
            <div class="form-group">
                <label>Enter 2FA Code</label>
                <input type="text" id="code" name="code" required>
            </div>
            <div class="button-group">
                <button type="button" class="back-button" id="backToLogin">
                    <span class="back-arrow"></span>
                    Back
                </button>
                <button type="submit">Submit</button>
            </div>
        </form>

        <div id="error" class="error hidden"></div>
    </div>

    <script>
        class UIState {
            static showElement(selector) {
                document.querySelector(selector).classList.remove('hidden');
            }

            static hideElement(selector) {
                document.querySelector(selector).classList.add('hidden');
            }

            static setDisplayName(name) {
                const element = document.querySelector('#displayName');
                element.textContent = 'Device Name: ';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'device-name';
                nameSpan.textContent = name;
                element.appendChild(nameSpan);
            }
        }

        class ErrorHandler {
            static #fadeTimeout;

            static show(message) {
                const errorDiv = document.querySelector('#error');
                errorDiv.textContent = message;
                UIState.showElement('#error');

                if (this.#fadeTimeout) {
                    clearTimeout(this.#fadeTimeout);
                }

                this.#fadeTimeout = setTimeout(() => {
                    errorDiv.classList.add('fade-out');
                    setTimeout(() => {
                        errorDiv.classList.add('hidden');
                        errorDiv.classList.remove('fade-out');
                    }, 500);
                }, 6000);
            }

            static hide() {
                const errorDiv = document.querySelector('#error');
                errorDiv.textContent = '';
                UIState.hideElement('#error');
            }
        }

        class AuthService {
            static async getInitialState() {
                const response = await fetch('get-state');
                return response.json();
            }

            static async submitAccount(formData) {
                const response = await fetch('submit-account', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams(formData)
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error);
                }
                return data;
            }

            static async submitCode(formData) {
                const response = await fetch('submit-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(formData)
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error);
                }
                return data;
            }
        }

        class AuthForm {
            static async handleLoginSubmit(event) {
                event.preventDefault();

                const passwordInput = document.querySelector('#password');
                try {
                    const data = await AuthService.submitAccount(new FormData(event.target));
                    ErrorHandler.hide();

                    if (data.requires2fa) {
                        UIState.hideElement('#loginForm');
                        UIState.showElement('#twoFactorForm');
                    } else if (data.success) {
                        UIState.hideElement('#loginForm');
                        UIState.showElement('#successMessage');
                    }
                } catch (err) {
                    ErrorHandler.show(err.message);
                    passwordInput.focus();
                } finally {
                    passwordInput.value = '';
                    passwordInput.type = 'password';
                    const toggleButton = document.querySelector('#togglePassword');
                    toggleButton.textContent = 'Show';
                }
            }

            static async handleTwoFactorSubmit(event) {
                event.preventDefault();

                const codeInput = document.querySelector('#code');
                try {
                    const data = await AuthService.submitCode(new FormData(event.target));
                    ErrorHandler.hide();

                    if (data.success) {
                        UIState.hideElement('#twoFactorForm');
                        UIState.hideElement('#connectedMessage');
                        UIState.showElement('#successMessage');
                    }
                } catch (err) {
                    ErrorHandler.show(err.message);
                    codeInput.focus();
                } finally {
                    codeInput.value = '';
                }
            }

            static togglePasswordVisibility(event) {
                const passwordInput = document.querySelector('#password');
                const type = passwordInput.type === 'password' ? 'text' : 'password';
                passwordInput.type = type;
                event.target.textContent = type === 'password' ? 'Show' : 'Hide';
            }

            static handleBackToLogin() {
                ErrorHandler.hide();
                UIState.hideElement('#twoFactorForm');
                UIState.showElement('#loginForm');
                const passwordInput = document.querySelector('#password');

                setTimeout(() => {
                    passwordInput.focus();
                }, 0);
            }

            static handleReauth() {
                try {
                    sessionStorage.setItem('forceReauth', 'true');
                    UIState.hideElement('#connectedMessage');
                    UIState.hideElement('#reauthMessage');
                    UIState.showElement('#loginForm');
                } catch (err) {
                    ErrorHandler.show('Failed to initiate reauthentication');
                }
            }
        }

        class AuthApp {
            static async initialize() {
                try {
                    const data = await AuthService.getInitialState();

                    if (data.displayName) {
                        UIState.setDisplayName(data.displayName);
                    }

                    if (data.connected) {
                        UIState.showElement('#connectedMessage');
                        if (sessionStorage.getItem('forceReauth')) {
                        UIState.showElement('#loginForm');
                        } else {
                        UIState.showElement('#reauthMessage');
                        }
                    } else {
                        UIState.showElement('#loginForm');
                    }
                } catch (err) {
                    console.error('Failed to get initial state:', err);
                    UIState.showElement('#loginForm');
                }
            }

            static setupEventListeners() {
                document.querySelector('#loginForm')
                .addEventListener('submit', AuthForm.handleLoginSubmit);

                document.querySelector('#twoFactorForm')
                .addEventListener('submit', AuthForm.handleTwoFactorSubmit);

                document.querySelector('#togglePassword')
                .addEventListener('click', AuthForm.togglePasswordVisibility);

                document.querySelector('#backToLogin')
                .addEventListener('click', AuthForm.handleBackToLogin);

                document.querySelector('#reauth')
                .addEventListener('click', AuthForm.handleReauth);
            }
        }

        document.addEventListener('DOMContentLoaded', () => {
            sessionStorage.clear();
            AuthApp.initialize();
            AuthApp.setupEventListeners();
        });
    </script>
</body>
</html>`