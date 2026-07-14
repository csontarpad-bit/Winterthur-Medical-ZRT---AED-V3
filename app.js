// ==========================================
// 1. ADATBÁZISOK ÉS GLOBÁLIS ÁLLAPOT
// ==========================================
let serviceDB = [];
let deviceDB = [];

let configState = {
    mode: null,
    quantity: 1,
    environment: 'indoor',
    costVsPro: 3, 
    deviceType: 'aed',
    proEnvironment: 'general',
    needDisplay: false,
    opMode: 'semi',
    childUse: false,
    displaySize: 2,
    batteryLife: 2,
    memoryCapacity: 2,
    defibMode: 'async',
    tempMeasurement: false,
    dataTransfer: 'none',
    monitorSpecs: { pacing: false, spo2: false, etco2: false, nibp: false, '12lead': false, printer: false },
    accessories: { wallMount: false, outdoorCabinet: false, childPad: false, extraPad: false, cprKit: false, training: false, maintenance: false },
    selectedDevice: null
};

const accessoryNames = { 
    wallMount: 'Beltéri Fali Konzol', 
    outdoorCabinet: 'Kültéri Fűthető Kabin (Riasztóval)', 
    childPad: 'Gyermek Elektróda', 
    extraPad: 'Tartalék Felnőtt Elektróda',
    cprKit: 'CPR Életmentő Készlet', 
    training: 'Helyszíni Oktatás', 
    maintenance: 'Éves Karbantartás' 
};

let routeSteps = []; 
let currentRouteIndex = 0;
let engineResults = [];
let compareList = [];

// ==========================================
// 2. GYORSÍTÓTÁRAZOTT DOM ELEMEK
// ==========================================
// (Mivel a script 'defer' attribútummal van meghívva, a DOM már betöltött)
const DOM = {
    container: document.getElementById('moduleContainer'),
    progressBar: document.getElementById('progressBar'),
    btnPrev: document.getElementById('btnPrev'),
    btnNext: document.getElementById('btnNext'),
    overlay: document.getElementById('heartbeatOverlay'),
    ekgPath: document.querySelector('.ekg-path'),
    heartbeatAudio: document.getElementById('heartbeatSound')
};

// ==========================================
// 3. VEZÉRLÉS ÉS ÁLLAPOT FRISSÍTÉS
// ==========================================
function setMode(mode) {
    configState.mode = mode;
    const allModules = document.querySelectorAll('.step-module');
    routeSteps = [];
    
    allModules.forEach(el => {
        const stepNum = parseInt(el.getAttribute('data-step'));
        if (stepNum <= 3 || stepNum >= 7) {
            routeSteps.push(el); // Közös kezdő és záró lépések
        } else if (el.classList.contains(`route-${mode}`)) {
            routeSteps.push(el); // Specifikus útvonal lépései
        }
    });

    DOM.btnNext.classList.remove('hidden');
}

function updateConfig(key, value) { configState[key] = value; }
function updateMonitorSpec(key, checked) { configState.monitorSpecs[key] = checked; }
function updateAccessory(key, isChecked) { configState.accessories[key] = isChecked; }

// Szinkronizált mennyiség léptetés (Gombokhoz és csúszkához)
function syncQtyDisplays(val) {
    let v = Math.max(1, Math.min(100, parseInt(val) || 1));
    configState.quantity = v;
    
    ['Simple', 'Expert'].forEach(type => {
        const slider = document.getElementById(`qtySlider${type}`);
        const display = document.getElementById(`qtyDisplay${type}`);
        if(slider) slider.value = v;
        if(display) display.innerText = v;
    });
}

function adjustQty(amount) {
    syncQtyDisplays(configState.quantity + amount);
}

function toggleMonitorQuestions() {
    const isMonitor = configState.deviceType === 'monitor';
    document.getElementById('monitorQuestionsBlock').classList.toggle('hidden', !isMonitor);
    document.getElementById('aedQuestionsBlock').classList.toggle('hidden', isMonitor);
}

// ==========================================
// 4. LÉPTETÉS MOTOR ÉS UI FRISSÍTÉS
// ==========================================
function changeStep(direction) {
    if (!configState.mode && currentRouteIndex === 2 && direction > 0) {
        alert("Kérjük, válasszon felhasználási profilt a folytatáshoz!"); 
        return;
    }

    const newIndex = currentRouteIndex + direction;
    
    if (newIndex >= 0 && newIndex < routeSteps.length) {
        if (DOM.heartbeatAudio) {
            DOM.heartbeatAudio.volume = 1.0;
            DOM.heartbeatAudio.currentTime = 0;
            DOM.heartbeatAudio.play().catch(() => console.log("Hanglejátszás blokkolva."));
        }

        DOM.container.classList.add('blur-sm', 'opacity-50', 'pointer-events-none');
        DOM.overlay.classList.remove('hidden');
        DOM.overlay.classList.add('flex');
        
        DOM.ekgPath.classList.remove('animate-ekg');
        void DOM.ekgPath.offsetWidth; // Reflow triggerelés az animáció újraindításához
        DOM.ekgPath.classList.add('animate-ekg');

        setTimeout(() => {
            routeSteps[currentRouteIndex].classList.remove('active');
            currentRouteIndex = newIndex;
            
            const nextStepNum = parseInt(routeSteps[currentRouteIndex].getAttribute('data-step'));
            
            handleStepSpecificLogic(nextStepNum);

            routeSteps[currentRouteIndex].classList.add('active');
            updateUI();
            
            DOM.container.classList.remove('blur-sm', 'opacity-50', 'pointer-events-none');
            setTimeout(() => { 
                DOM.overlay.classList.add('hidden'); 
                DOM.overlay.classList.remove('flex'); 
            }, 150);

        }, 750); 
    }
}

function handleStepSpecificLogic(stepNum) {
    // Kiegészítők előtti logika
    if (stepNum === 9) {
        const isOutdoor = (configState.mode === 'simple' && configState.environment === 'outdoor') || 
                          (configState.mode === 'expert' && ['public', 'emergency'].includes(configState.proEnvironment));
        
        const outdoorWrapper = document.getElementById('outdoorCabinetWrapper');
        if (outdoorWrapper) {
            outdoorWrapper.style.display = isOutdoor ? 'block' : 'none';
            if (!isOutdoor) {
                document.getElementById('chk_outdoorCabinet').checked = false;
                configState.accessories.outdoorCabinet = false;
            }
        }

        if (configState.mode === 'expert' && configState.childUse) {
            document.getElementById('chk_childPad').checked = true;
            configState.accessories.childPad = true;
        }
    }

    // Ajánlómotor futtatása
    if (stepNum === 10) runScoringEngine();

    // Összegzés panel felépítése
    if (stepNum === 11) buildFinalSummary();
}

function updateUI() {
    const progress = (currentRouteIndex / (routeSteps.length - 1)) * 100;
    DOM.progressBar.style.width = `${progress}%`;
    
    DOM.btnPrev.classList.toggle('invisible', currentRouteIndex === 0);

    const hideNext = (currentRouteIndex === 2 && !configState.mode) || (currentRouteIndex === routeSteps.length - 1);
    DOM.btnNext.classList.toggle('hidden', hideNext);
}

function buildFinalSummary() {
    document.getElementById('summaryQty').innerText = `${configState.quantity} db`;
    document.getElementById('summaryDeviceName').innerText = configState.selectedDevice || 'Készülék kiválasztása folyamatban...';
    
    const envDiv = document.getElementById('summaryEnv');
    if (configState.mode === 'simple') {
        const isIndoor = configState.environment === 'indoor';
        envDiv.innerHTML = isIndoor 
            ? '<i class="fa-solid fa-building mr-2 text-gray-400"></i>Kizárólag beltéri elhelyezés'
            : '<i class="fa-solid fa-tree-city mr-2 text-brand-lightblue"></i>Kültéri elhelyezést is igényel';
    } else {
        const envMap = { 'general': 'Általános betegellátás', 'emergency': 'Sürgősségi/Mentő', 'icu': 'Intenzív osztály', 'public': 'Közterület' };
        envDiv.innerHTML = `<i class="fa-solid fa-hospital mr-2 text-brand-lightblue"></i>${envMap[configState.proEnvironment]}`;
    }

    const listUl = document.getElementById('summaryAccessories');
    listUl.innerHTML = '';
    let hasAccessory = false;
    
    for (const [key, isChecked] of Object.entries(configState.accessories)) {
        if (isChecked) {
            hasAccessory = true;
            listUl.innerHTML += `<li class="flex items-start"><i class="fa-solid fa-check text-green-500 mt-1 mr-2"></i> <span>${accessoryNames[key]}</span></li>`;
        }
    }
    
    if (!hasAccessory) {
        listUl.innerHTML = '<li class="text-gray-400 italic">Nem választott kiegészítő opciót.</li>';
    }
}

// ==========================================
// 5. INTELLIGENS PONTOZÓ MOTOR
// ==========================================
function runScoringEngine() {
    engineResults = deviceDB.map(device => {
        let score = 100; 
        
        if (configState.mode === 'expert') {
            if (configState.deviceType === 'monitor' && device.type === 'aed') score = 0;
            if (configState.deviceType === 'aed' && device.type === 'monitor') score = 0;
            if (configState.deviceType === 'aed' && configState.needDisplay && !device.display) score -= 40; 
        } else if (configState.mode === 'simple') {
            const diff = Math.abs(parseInt(configState.costVsPro) - device.costLevel);
            score -= (diff * 15); 
        }

        if (score > 0) score -= Math.floor(Math.random() * 4); 
        return { ...device, match: Math.max(10, score) };
    }).sort((a, b) => b.match - a.match);

    const resultsDiv = document.getElementById('recommendationResults');
    resultsDiv.innerHTML = '';
    const top3 = engineResults.slice(0, 3);
    
    if (top3.length > 0) configState.selectedDevice = top3[0].name;

top3.forEach((res, idx) => {
        const isChecked = idx === 0 ? 'checked' : '';
        // 1. A medál új formázása (hogy elférjen a szöveg mellett)
        const medal = idx === 0 ? `<div class="w-8 h-8 bg-brand-yellow text-white rounded-full flex items-center justify-center shadow text-sm flex-shrink-0 mr-3"><i class="fa-solid fa-star"></i></div>` : '';
        
        resultsDiv.innerHTML += `
            <label class="radio-card cursor-pointer block w-full relative group">
                <input type="radio" name="selectedRecommendation" value="${res.name}" ${isChecked} onchange="updateConfig('selectedDevice', '${res.name}')">
                <div class="border-2 border-gray-200 bg-white p-4 rounded-xl flex items-center shadow-sm relative transition-all hover:border-brand-lightblue h-full">
                    <div class="check-icon absolute top-3 right-3 text-brand-blue opacity-0 transition-all scale-50"><i class="fa-solid fa-circle-check text-xl"></i></div>
                    
                    <div class="w-16 h-16 md:w-20 md:h-20 flex-shrink-0 bg-white border border-gray-100 rounded-lg overflow-hidden flex items-center justify-center mr-4 p-1">
                        <img src="${res.image}" alt="${res.name}" onclick="openProductModal('${res.name}', 'product')" class="max-w-full max-h-full object-contain cursor-pointer hover:opacity-80 transition-opacity">
                    </div>
                    
                    <div class="text-xl md:text-2xl font-bold ${idx === 0 ? 'text-brand-blue' : 'text-gray-400'} w-14 md:w-20 text-center border-r border-gray-200 mr-4 flex-shrink-0">
                        ${res.match}%
                    </div>
                    
                    <div class="flex-grow pr-6">
                        <div class="flex items-center mb-1">
                            ${medal}
                            <h4 class="font-bold text-lg md:text-xl text-gray-900 leading-tight">${res.name}</h4>
                        </div>
                        
                        <p class="text-xs md:text-sm text-gray-600 line-clamp-2 md:line-clamp-none">${res.description}</p>
                        
                        <div class="mt-3 inline-flex items-center gap-2 bg-gray-50 border border-gray-200 px-3 py-1 rounded-full cursor-pointer hover:bg-gray-100 transition-colors z-20" onclick="event.stopPropagation();">
                            <input type="checkbox" id="comp_${res.name}" class="w-4 h-4 text-brand-yellow focus:ring-brand-yellow rounded cursor-pointer" onclick="event.stopPropagation();" onchange="toggleCompare('${res.name}', this.checked)">
                            <span class="text-xs font-bold text-gray-600" onclick="document.getElementById('comp_${res.name}').click();"><i class="fa-solid fa-code-compare mr-1"></i> VS Összehasonlít</span>
                        </div>
                    </div>
                </div>
            </label>`;
    });
}

// ==========================================
// 6. MINICRM BEKÜLDÉS ÉS ADATGYŰJTÉS
// ==========================================
async function submitForm(e) {
    e.preventDefault();
    const btn = document.getElementById('submitBtn');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Adatok feldolgozása...';
    btn.disabled = true;

    let crmText = `--- ÚJ AJÁNLATKÉRÉS ---\nÜgyfél profil: ${configState.mode === 'expert' ? 'Klinikai/Profi' : 'Vállalati/Laikus'}\nIgényelt darabszám: ${configState.quantity} db\n`;
    
    if (configState.mode === 'simple') {
        crmText += `Környezet: ${configState.environment === 'indoor' ? 'Kizárólag beltér' : 'Kültér is érintett'}\n`;
    } else {
        const envMap = { 'general': 'Általános betegellátás', 'emergency': 'Sürgősségi/Mentő', 'icu': 'Intenzív osztály', 'public': 'Közterület' };
        crmText += `Környezet: ${envMap[configState.proEnvironment]}\n\n--- TECHNIKAI SPECIFIKÁCIÓ (PROFI ÁG) ---\n`;
        const displayMap = { "1": "5\" (Kompakt)", "2": "7\" (Sztenderd)", "3": "10\"+ (Nagy)" };
        const batteryMap = { "1": "2 óra", "2": "4 óra", "3": "6+ óra" };
        const memoryMap = { "1": "50 esemény", "2": "200 esemény", "3": "Korlátlan/Felhő" };
        const dataTransferMap = { "none": "Nincs", "wifi": "Wi-Fi", "lte": "4G / LTE" };
        
        crmText += `Kijelző mérete: ${displayMap[configState.displaySize]}\nAkkumulátor: ${batteryMap[configState.batteryLife]}\nEsemény naplózás: ${memoryMap[configState.memoryCapacity]}\nDefibrillációs mód: ${configState.defibMode === 'sync' ? 'Szinkronizált Kardioverzió' : 'Manuális Aszinkron'}\nHőmérséklet mérés: ${configState.tempMeasurement ? 'Szükséges' : 'Nem kell'}\nAdatátvitel: ${dataTransferMap[configState.dataTransfer]}\n`;
    }
    
    let selectedMatchText = '';
    if (configState.selectedDevice) {
        const selectedRes = engineResults.find(d => d.name === configState.selectedDevice);
        if (selectedRes) selectedMatchText = `(${selectedRes.match}% egyezés)`;
    }

    crmText += `\n--- KIVÁLASZTOTT KÉSZÜLÉK ---\nNév: ${configState.selectedDevice || 'Nem választott'} ${selectedMatchText}\n\n--- KIEGÉSZÍTŐK ÉS SZOLGÁLTATÁSOK ---\n`;
    
    const selectedAccessories = Object.keys(configState.accessories).filter(k => configState.accessories[k]);
    if (selectedAccessories.length > 0) {
        selectedAccessories.forEach(k => crmText += `- ${accessoryNames[k]}\n`);
    } else {
        crmText += `- Nincs kiegészítő kiválasztva.\n`;
    }

    const userNote = document.getElementById('userNoteInput').value;
    crmText += `\n--- ÜGYFÉL MEGJEGYZÉSE ---\n${userNote || 'Nem hagyott megjegyzést.'}`;
    
    document.getElementById('hiddenCompiledConfig').value = crmText;

    try {
        const miniCrmUrl = "81711-2d0r9b69n90qm5rdg0c0275y1en9d5@in.minicrm.hu"; 
        const formData = new FormData();
        formData.append("Megjegyzes", crmText); 
        
        await fetch(miniCrmUrl, { method: "POST", body: formData, mode: "no-cors" });

        document.getElementById('leadForm').classList.add('hidden');
        const successMsg = document.getElementById('successMessage');
        successMsg.classList.remove('hidden');
        successMsg.classList.add('flex');
        document.getElementById('footerControls').classList.add('hidden');
        
    } catch (error) {
        console.error(error);
        alert("Hiba történt az adatküldés során. Kérjük próbálja újra!");
        btn.innerHTML = 'Ajánlatkérés elküldése';
        btn.disabled = false;
    }
}

// ==========================================
// 7. INICIALIZÁLÁS ÉS MODALOK
// ==========================================
async function initApp() {
    try {
        const response = await fetch('adatbazis.json');
        const data = await response.json();
        deviceDB = data.devices;
        serviceDB = data.services;
        
        renderDynamicServices();

        document.querySelector(`.step-module[data-step="1"]`).classList.add('active');
        DOM.btnNext.classList.remove('hidden'); 
        document.querySelectorAll('.step-module').forEach(el => {
            if(parseInt(el.getAttribute('data-step')) <= 3) routeSteps.push(el);
        });
    } catch (error) {
        console.error("Hiba történt az adatbázis betöltésekor:", error);
        alert("Rendszerhiba: Nem sikerült betölteni a termékadatokat. Kérjük, frissítse az oldalt!");
    }
}

initApp();

function openProductModal(itemName, type = 'product') {
    const item = type === 'product' ? deviceDB.find(d => d.name === itemName) : serviceDB.find(s => s.name === itemName);
    if (!item) return;

    document.getElementById('modalContent').innerHTML = `
        <h2 class="text-3xl font-bold mb-4 text-brand-blue">${item.name}</h2>
        <img src="${item.image}" class="w-full h-64 object-contain mb-6 rounded-lg">
        <p class="text-gray-700 leading-relaxed mb-8">${item.description}</p>
        <button onclick="closeProductModal()" class="w-full bg-brand-blue hover:bg-blue-800 text-white py-3 rounded-lg font-bold transition-all">Bezárás</button>
    `;
    document.getElementById('productModal').classList.add('active');
}

function closeProductModal() {
    document.getElementById('productModal').classList.remove('active');
}

function toggleCompare(deviceName, isChecked) {
    if (isChecked) {
        if (compareList.length >= 2) {
            alert("Maximum 2 készüléket választhat az összehasonlításhoz!");
            document.getElementById(`comp_${deviceName}`).checked = false;
            return;
        }
        compareList.push(deviceName);
    } else {
        compareList = compareList.filter(n => n !== deviceName);
    }
    
    const btn = document.getElementById('floatingCompareBtn');
    btn.classList.toggle('hidden', compareList.length !== 2);
    btn.classList.toggle('flex', compareList.length === 2);
}

function openCompareModal() {
    if (compareList.length !== 2) return;
    
    const dev1 = deviceDB.find(d => d.name === compareList[0]);
    const dev2 = deviceDB.find(d => d.name === compareList[1]);

    document.getElementById('compareTableContainer').innerHTML = `
        <table class="w-full text-left border-collapse min-w-[600px]">
            <thead>
                <tr class="bg-gray-50 border-b-2 border-brand-blue">
                    <th class="p-4 font-bold text-gray-700 w-1/3 rounded-tl-lg">Tulajdonság</th>
                    <th class="p-4 font-bold text-brand-blue w-1/3 text-center text-xl">${dev1.name}</th>
                    <th class="p-4 font-bold text-brand-blue w-1/3 text-center text-xl rounded-tr-lg">${dev2.name}</th>
                </tr>
            </thead>
            <tbody>
                <tr class="border-b border-gray-200">
                    <td class="p-4 font-semibold text-gray-600"><i class="fa-solid fa-image mr-2"></i> Kép</td>
                    <td class="p-4"><img src="${dev1.image}" class="h-24 mx-auto object-contain"></td>
                    <td class="p-4"><img src="${dev2.image}" class="h-24 mx-auto object-contain"></td>
                </tr>
                <tr class="border-b border-gray-200 bg-gray-50">
                    <td class="p-4 font-semibold text-gray-600"><i class="fa-solid fa-weight-hanging mr-2"></i> Súly</td>
                    <td class="p-4 text-center font-bold">${dev1.specs.weight}</td>
                    <td class="p-4 text-center font-bold">${dev2.specs.weight}</td>
                </tr>
                <tr class="border-b border-gray-200">
                    <td class="p-4 font-semibold text-gray-600"><i class="fa-solid fa-droplet-slash mr-2"></i> IP Védettség</td>
                    <td class="p-4 text-center text-sm">${dev1.specs.ip}</td>
                    <td class="p-4 text-center text-sm">${dev2.specs.ip}</td>
                </tr>
                <tr class="border-b border-gray-200 bg-gray-50">
                    <td class="p-4 font-semibold text-gray-600"><i class="fa-solid fa-battery-full mr-2"></i> Akkumulátor</td>
                    <td class="p-4 text-center text-sm">${dev1.specs.battery}</td>
                    <td class="p-4 text-center text-sm">${dev2.specs.battery}</td>
                </tr>
                <tr class="border-b border-gray-200">
                    <td class="p-4 font-semibold text-gray-600"><i class="fa-solid fa-tv mr-2"></i> Kijelző</td>
                    <td class="p-4 text-center text-sm">${dev1.specs.display}</td>
                    <td class="p-4 text-center text-sm">${dev2.specs.display}</td>
                </tr>
                <tr class="border-b border-gray-200 bg-gray-50">
                    <td class="p-4 font-semibold text-gray-600"><i class="fa-solid fa-heart-pulse mr-2"></i> Pacemaker</td>
                    <td class="p-4 text-center text-sm">${dev1.specs.pacing}</td>
                    <td class="p-4 text-center text-sm">${dev2.specs.pacing}</td>
                </tr>
            </tbody>
        </table>
    `;
    
    document.getElementById('compareModal').classList.remove('hidden');
    document.getElementById('compareModal').classList.add('flex');
}

function closeCompareModal() {
    const modal = document.getElementById('compareModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    
    compareList = [];
    document.querySelectorAll('input[id^="comp_"]').forEach(cb => cb.checked = false);
    
    const btn = document.getElementById('floatingCompareBtn');
    btn.classList.add('hidden');
    btn.classList.remove('flex');
}

function renderDynamicServices() {
    const serviceMeta = {
        'Fali Konzolok & Kabinok': { icon: 'fa-box-open', color: 'brand-blue', step: 7 },
        'Gyermek Elektródák': { icon: 'fa-child', color: 'brand-blue', step: 7 },
        'CPR Kezdőkészlet': { icon: 'fa-scissors', color: 'brand-blue', step: 7 },
        'Helyszíni Betanítás és Oktatás': { icon: 'fa-user-doctor', color: 'brand-blue', bgHover: 'blue-50', step: 8, shortName: 'Helyszíni Oktatás' },
        'Éves Karbantartási Szerződés': { icon: 'fa-wrench', color: 'brand-yellow', bgHover: 'yellow-50', step: 8, shortName: 'Rendszeres Karbantartás' }
    };

    const container7 = document.getElementById('dynamicServicesStep7');
    const container8 = document.getElementById('dynamicServicesStep8');

    if (container7) container7.innerHTML = '';
    if (container8) container8.innerHTML = '';

    serviceDB.forEach(service => {
        const meta = serviceMeta[service.name];
        if (!meta) return;

        if (meta.step === 7) {
            container7.innerHTML += `
                <div class="bg-white border border-gray-100 p-6 rounded-xl shadow-sm transition-all cursor-pointer hover:border-brand-blue h-full flex flex-col" onclick="openProductModal('${service.name}', 'service')">
                    <div class="w-12 h-12 bg-blue-50 text-brand-blue rounded-lg flex items-center justify-center text-xl mb-4 flex-shrink-0">
                        <i class="fa-solid ${meta.icon}"></i>
                    </div>
                    <h3 class="font-bold text-gray-800 mb-3 font-heading text-lg leading-tight">${service.name}</h3>
                    <p class="text-sm text-gray-600 leading-relaxed flex-grow">${service.description}</p>
                </div>
            `;
        } else if (meta.step === 8) {
            const mbClass = service.name === 'Helyszíni Betanítás és Oktatás' ? 'mb-4' : '';
            container8.innerHTML += `
                <div class="bg-white border border-l-4 border-l-${meta.color} p-4 rounded shadow-sm ${mbClass} cursor-pointer hover:bg-${meta.bgHover} transition-all" onclick="openProductModal('${service.name}', 'service')">
                    <h4 class="font-bold text-gray-900 mb-1 text-${meta.color}">
                        <i class="fa-solid ${meta.icon} text-${meta.color} mr-2"></i> ${meta.shortName}
                    </h4>
                    <p class="text-sm text-gray-600">${service.description}</p>
                </div>
            `;
        }
    });
}