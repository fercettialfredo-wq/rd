/* =========================================
   RAVENS GUARD - NFC TRACKING
   ========================================= */

const CONFIG = {
    // Tu Proxy de Azure existente
    API_PROXY_URL: 'https://proxyguard.azurewebsites.net/api/ravens-proxy'
};

const STATE = {
    session: {
        isLoggedIn: false,
        condominioId: null,
        usuario: null
    },
    isScanning: false,
    isProcessing: false, // Evita lecturas duplicadas en milisegundos
    ndefReader: null,
    abortController: null // Permite apagar la antena NFC al leer
};

/* =========================================
   1. PANTALLAS
   ========================================= */

const SCREENS = {
    'LOGIN': `
        <div class="login-screen">
            <div class="login-box">
                <div style="text-align:center; margin-bottom:40px;">
                    <img src="icons/logo.png" alt="Ravens Logo" style="width: 120px; height: auto; margin-bottom: 15px;">
                    
                    <h1 style="color:white; font-size:1.6rem; margin:0;">RAVENS GUARD</h1>
                    <p style="color:#666; font-size:0.8rem;">Control de Rondines NFC</p>
                </div>
                <div class="input-group">
                    <label>Usuario</label>
                    <input type="text" id="login-user" class="form-input" placeholder="Guardia">
                </div>
                <div class="input-group">
                    <label>Contraseña</label>
                    <input type="password" id="login-pass" class="form-input" placeholder="••••••">
                </div>
                <button class="btn-primary" onclick="doLogin()">INGRESAR</button>
                <p id="login-error" style="color:#ef4444; text-align:center; margin-top:20px; display:none;"></p>
            </div>
        </div>
    `,

    'MAIN': `
        <div class="main-screen">
            <header class="header-app">
                <div class="header-logo-text">RONDINES</div>
                <div onclick="doLogout()" style="cursor:pointer; color:#ef4444;">
                    <i class="fas fa-sign-out-alt fa-lg"></i>
                </div>
            </header>
            
            <div class="scan-container">
                <div id="status-text" style="color:white; margin-bottom:30px; font-size:1.2rem; font-weight:bold;">Listo para escanear</div>
                
                <div id="nfc-btn" class="nfc-button" onclick="toggleNFCScan()">
                    <i class="fas fa-wifi"></i>
                    <span id="btn-text">ESCANEAR</span>
                </div>

                <div class="info-text">
                    Acerca el dispositivo al punto de control NFC.

                    Asegúrate de tener el NFC activado.
                </div>
            </div>
        </div>
    `
};

/* =========================================
   2. FUNCIONES PRINCIPALES
   ========================================= */

// --- NAVEGACIÓN ---
function navigate(screenName) {
    const viewport = document.getElementById('viewport');
    viewport.innerHTML = SCREENS[screenName];
}

// --- LOGIN ---
async function doLogin() {
    const user = document.getElementById('login-user').value;
    const pass = document.getElementById('login-pass').value;
    const errorMsg = document.getElementById('login-error');

    if(!user || !pass) return;

    // Feedback visual simple
    const btn = document.querySelector('.btn-primary');
    btn.innerText = "Verificando...";
    btn.disabled = true;

    try {
        const response = await fetch(CONFIG.API_PROXY_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ action: 'login', username: user, password: pass }) 
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            const condId = data.condominioId || data.condominio || (data.data && data.data.condominio);
            
            STATE.session = {
                isLoggedIn: true,
                condominioId: condId,
                usuario: user
            };
            
            localStorage.setItem('ravensGuardUser', JSON.stringify(STATE.session));
            navigate('MAIN');
        } else { 
            throw new Error(data.message || "Credenciales incorrectas."); 
        }
    } catch (error) { 
        errorMsg.innerText = error.message; 
        errorMsg.style.display = "block";
        btn.innerText = "INGRESAR";
        btn.disabled = false;
    }
}

function doLogout() {
    localStorage.removeItem('ravensGuardUser');
    STATE.session = { isLoggedIn: false, condominioId: null, usuario: null };
    navigate('LOGIN');
}

function checkSession() {
    const saved = localStorage.getItem('ravensGuardUser');
    if (saved) {
        STATE.session = JSON.parse(saved);
        if (STATE.session.condominioId) {
            navigate('MAIN');
        } else {
            navigate('LOGIN');
        }
    } else {
        navigate('LOGIN');
    }
}

/* =========================================
   3. LÓGICA NFC
   ========================================= */

async function toggleNFCScan() {
    const btn = document.getElementById('nfc-btn');
    const statusTxt = document.getElementById('status-text');
    const btnTxt = document.getElementById('btn-text');

    // Prevenir que se inicie si ya está escaneando o procesando una lectura
    if (STATE.isScanning || STATE.isProcessing) {
        return;
    }

    if (!('NDEFReader' in window)) {
        alert("Tu dispositivo o navegador no soporta lectura NFC web. Asegúrate de usar Chrome en Android y HTTPS.");
        return;
    }

    try {
        STATE.abortController = new AbortController(); // Crear controlador para detener el escaneo luego
        STATE.ndefReader = new NDEFReader();
        
        // Iniciar escaneo con la señal de aborto
        await STATE.ndefReader.scan({ signal: STATE.abortController.signal });
        
        // Cambio visual a modo "Escuchando"
        STATE.isScanning = true;
        btn.classList.add('scanning');
        statusTxt.innerText = "Acerca el TAG ahora...";
        btnTxt.innerText = "LEYENDO...";

        STATE.ndefReader.onreading = event => {
            handleNFCReading(event);
        };

        STATE.ndefReader.onreadingerror = () => {
            if (STATE.isProcessing) return;
            STATE.isProcessing = true; // Bloqueamos para evitar spam de errores
            showModal('error', "Error al leer etiqueta. Intenta de nuevo.");
            resetScanUI();
        };

    } catch (error) {
        console.error(error);
        alert("Error al iniciar NFC: " + error);
        resetScanUI();
    }
}

function resetScanUI() {
    STATE.isScanning = false;
    const btn = document.getElementById('nfc-btn');
    const statusTxt = document.getElementById('status-text');
    const btnTxt = document.getElementById('btn-text');
    
    if(btn) {
        btn.classList.remove('scanning');
        statusTxt.innerText = "Listo para escanear";
        btnTxt.innerText = "ESCANEAR";
    }
}

async function handleNFCReading(event) {
    // Si ya estamos procesando una lectura, ignoramos los rebotes del sensor
    if (STATE.isProcessing) return; 
    
    // Bloqueamos nuevas lecturas inmediatamente
    STATE.isProcessing = true;

    // Apagamos la antena NFC para evitar lecturas en ráfaga
    if (STATE.abortController) {
        STATE.abortController.abort();
    }

    const serialNumber = event.serialNumber;
    
    if (!serialNumber) {
        showModal('error', "Lectura vacía");
        resetScanUI();
        // Nota: NO liberamos isProcessing aquí. Se liberará al cerrar el modal.
        return;
    }

    // Detener UI de escaneo
    resetScanUI();
    
    // Enviar a Base de Datos de forma controlada
    await registerPositionInDB(serialNumber);
    
    // Nota: El candado isProcessing se liberará únicamente cuando el guardia cierre el modal.
}

/* =========================================
   4. ENVÍO A BASE DE DATOS
   ========================================= */

async function registerPositionInDB(tagId) {
    showModal('loading', "Registrando posición...");

    const payload = {
        action: 'submit_form',
        formulario: 'RONDINES',
        condominio: STATE.session.condominioId,
        usuario: STATE.session.usuario,
        data: {
            TagID: tagId,
            Guardia: STATE.session.usuario,
            Condominio: STATE.session.condominioId,
            Fecha: new Date().toISOString(),
            TipoMarca: "Rondín",
            Estatus: "Registrado"
        }
    };

    try {
        const response = await fetch(CONFIG.API_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const res = await response.json();

        if (res.success) {
            // Muestra solo el mensaje de éxito sin el ID del tag
            showModal('success', "Posición registrada");
        } else {
            showModal('error', "Error: " + res.message);
        }

    } catch (error) {
        showModal('error', "Error de conexión");
    }
}

/* =========================================
   5. UTILIDADES UI (MODAL)
   ========================================= */

function showModal(type, text) {
    const modal = document.getElementById('status-modal');
    let content = '';

    if (type === 'loading') {
        content = `<div class="modal-content"><i class="fas fa-circle-notch fa-spin modal-icon" style="color:#2563eb"></i><p>${text}</p></div>`;
    } else if (type === 'success') {
        content = `<div class="modal-content"><i class="fas fa-check-circle modal-icon" style="color:#16a34a"></i><p>${text}</p><button class="btn-primary" onclick="closeModal()" style="margin-top:10px; background:#16a34a">OK</button></div>`;
    } else if (type === 'error') {
        content = `<div class="modal-content"><i class="fas fa-times-circle modal-icon" style="color:#ef4444"></i><p>${text}</p><button class="btn-primary" onclick="closeModal()" style="margin-top:10px;">Cerrar</button></div>`;
    }

    modal.innerHTML = content;
    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('status-modal').style.display = 'none';
    
    // LA SOLUCIÓN: Solo liberamos el candado de lectura cuando el usuario explícitamente cierra el modal.
    // Esto previene al 100% las lecturas dobles por dejar el teléfono apoyado o por rebotes de la antena NFC.
    STATE.isProcessing = false; 
}

// INICIO
window.onload = () => {
    checkSession();
};
