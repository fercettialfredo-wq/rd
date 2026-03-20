/* =========================================
   RAVENS GUARD - NFC TRACKING (OFFLINE SUPPORT V2)
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
    isProcessing: false, 
    ndefReader: null,
    abortController: null 
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
                <div class="header-logo-text">
                    RONDINES 
                    <span id="sync-status" onclick="syncOfflineData(true)" style="font-size:0.75rem; color:#facc15; display:none; cursor:pointer; background:rgba(255,255,255,0.15); padding:4px 8px; border-radius:6px; margin-left:10px;">
                        <i class="fas fa-sync-alt"></i> Pendientes
                    </span>
                </div>
                <div onclick="doLogout()" style="cursor:pointer; color:#ef4444;" title="Cerrar sesión">
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

function navigate(screenName) {
    const viewport = document.getElementById('viewport');
    if (viewport) {
        viewport.innerHTML = SCREENS[screenName];
        if (screenName === 'MAIN') {
            updateSyncUI(); 
        }
    }
}

async function doLogin() {
    const user = document.getElementById('login-user').value.trim();
    const pass = document.getElementById('login-pass').value;
    const errorMsg = document.getElementById('login-error');

    if(!user || !pass) return;

    if (!navigator.onLine) {
        errorMsg.innerText = "Necesitas conexión a internet para iniciar sesión.";
        errorMsg.style.display = "block";
        return;
    }

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
            const condId = data.condominioId || data.condominio || (data.data && data.data.condominio) || "NO_ID";
            
            STATE.session = {
                isLoggedIn: true,
                condominioId: condId,
                usuario: user
            };
            
            localStorage.setItem('ravensGuardUser', JSON.stringify(STATE.session));
            navigate('MAIN');
            syncOfflineData(); // Intentar subir pendientes tras login
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
    try {
        const saved = localStorage.getItem('ravensGuardUser');
        if (saved) {
            const parsedData = JSON.parse(saved);
            
            if (parsedData && parsedData.isLoggedIn === true && parsedData.usuario) {
                STATE.session = parsedData;
                navigate('MAIN');
                syncOfflineData(); 
                return;
            }
        }
    } catch (e) {
        console.error("Error al recuperar la sesión local:", e);
    }
    
    navigate('LOGIN');
}

/* =========================================
   3. LÓGICA NFC
   ========================================= */

async function toggleNFCScan() {
    const btn = document.getElementById('nfc-btn');
    const statusTxt = document.getElementById('status-text');
    const btnTxt = document.getElementById('btn-text');

    if (STATE.isScanning || STATE.isProcessing) {
        return;
    }

    if (!('NDEFReader' in window)) {
        alert("Tu dispositivo o navegador no soporta lectura NFC web. Asegúrate de usar Chrome en Android y HTTPS.");
        return;
    }

    // Aprovechamos que va a escanear para intentar limpiar la cola silenciosamente
    if (navigator.onLine) {
        syncOfflineData(false); 
    }

    try {
        STATE.abortController = new AbortController(); 
        STATE.ndefReader = new NDEFReader();
        
        await STATE.ndefReader.scan({ signal: STATE.abortController.signal });
        
        STATE.isScanning = true;
        btn.classList.add('scanning');
        statusTxt.innerText = "Acerca el TAG ahora...";
        btnTxt.innerText = "LEYENDO...";

        STATE.ndefReader.onreading = event => {
            handleNFCReading(event);
        };

        STATE.ndefReader.onreadingerror = () => {
            if (STATE.isProcessing) return;
            STATE.isProcessing = true; 
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
    if (STATE.isProcessing) return; 
    
    STATE.isProcessing = true;

    if (STATE.abortController) {
        STATE.abortController.abort();
    }

    const serialNumber = event.serialNumber;
    
    if (!serialNumber) {
        showModal('error', "Lectura vacía");
        resetScanUI();
        return;
    }

    resetScanUI();
    await registerPositionInDB(serialNumber);
}

/* =========================================
   4. ENVÍO A BASE DE DATOS Y MODO OFFLINE
   ========================================= */

async function registerPositionInDB(tagId) {
    showModal('loading', "Procesando...");

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

    if (!navigator.onLine) {
        saveToOfflineQueue(payload);
        showModal('success', "Guardado localmente (Sin red)");
        return;
    }

    try {
        const response = await fetch(CONFIG.API_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const res = await response.json();

        if (res.success) {
            showModal('success', "Posición registrada en línea");
            syncOfflineData(); 
        } else {
            showModal('error', "Error del servidor: " + res.message);
        }

    } catch (error) {
        saveToOfflineQueue(payload);
        showModal('success', "Guardado localmente (Red inestable)");
    }
}

function saveToOfflineQueue(payload) {
    let queue = JSON.parse(localStorage.getItem('ravensOfflineQueue')) || [];
    queue.push(payload);
    localStorage.setItem('ravensOfflineQueue', JSON.stringify(queue));
    updateSyncUI();
}

// Nueva función de sincronización mejorada
async function syncOfflineData(isManual = false) {
    if (!navigator.onLine) {
        if (isManual) showModal('error', "Aún no hay conexión a internet estable.");
        return;
    }

    let queue = JSON.parse(localStorage.getItem('ravensOfflineQueue')) || [];
    if (queue.length === 0) {
        updateSyncUI();
        return;
    }

    // Si el usuario tocó el botón, le mostramos que está cargando
    if (isManual) {
        showModal('loading', `Enviando ${queue.length} lecturas pendientes...`);
    }

    let newQueue = [];
    let successCount = 0;

    for (let i = 0; i < queue.length; i++) {
        try {
            const response = await fetch(CONFIG.API_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(queue[i])
            });
            const res = await response.json();
            
            if (res.success) {
                successCount++;
            } else {
                newQueue.push(queue[i]); // Falló por algo del servidor, se queda
            }
        } catch (error) {
            newQueue.push(queue[i]); // Falló la red a medio camino, se queda
        }
    }

    // Actualizamos el almacenamiento con los que fallaron (si es que hubo)
    localStorage.setItem('ravensOfflineQueue', JSON.stringify(newQueue));
    updateSyncUI();
    
    // Feedback final si fue manual o si hubo éxito
    if (isManual) {
        if (newQueue.length === 0) {
            showModal('success', "¡Sincronización completada!");
        } else {
            showModal('error', `Se enviaron ${successCount}. Faltan ${newQueue.length} por error de red.`);
        }
    } else if (successCount > 0 && newQueue.length === 0 && STATE.session.isLoggedIn) {
        console.log("Sincronización silenciosa completada.");
    }
}

function updateSyncUI() {
    const syncBadge = document.getElementById('sync-status');
    if (!syncBadge) return;

    let queue = JSON.parse(localStorage.getItem('ravensOfflineQueue')) || [];
    if (queue.length > 0) {
        syncBadge.style.display = 'inline-block';
        // Actualizamos el número en el texto del botón
        syncBadge.innerHTML = `<i class="fas fa-sync-alt"></i> ${queue.length} Pendiente(s)`;
    } else {
        syncBadge.style.display = 'none';
    }
}

/* =========================================
   5. UTILIDADES UI (MODAL)
   ========================================= */

function showModal(type, text) {
    const modal = document.getElementById('status-modal');
    if (!modal) return;
    
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
    const modal = document.getElementById('status-modal');
    if (modal) modal.style.display = 'none';
    STATE.isProcessing = false; 
}

/* =========================================
   6. EVENTOS DE RED Y ARRANQUE
   ========================================= */

window.addEventListener('online', () => {
    // Cuando el celular detecta que regresó el WiFi/Datos, intenta sincronizar calladito
    syncOfflineData(false);
});

window.addEventListener('offline', () => {
    console.log("Sin conexión a internet. Modo offline activado.");
});

window.onload = () => {
    checkSession();
};
