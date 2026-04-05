const API_URL = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
let currentUser = null;
let sitesData = [];
let faceMatcher = null;
let lastLocation = null;
let registeredFaceDescriptor = null;
let currentFaceDescriptor = null; // Stored during video match
let tempEmail = ""; // used during registration
const MODEL_URL = '../models';

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});

function showSection(id) {
    document.querySelectorAll('.glass-card').forEach(el => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function checkSession() {
    const userJson = localStorage.getItem('empSession');
    if (userJson) {
        currentUser = JSON.parse(userJson);
        showSection('dashboardSection');
        document.getElementById('welcomeText').innerText = `مرحباً ${currentUser.name}`;
        initSystem();
    } else {
        showSection('loginSection');
    }
}

// 1. Normal Login
async function login() {
    const email = document.getElementById('loginEmail').value.trim();
    const pass = document.getElementById('loginPass').value.trim();
    if (!email || !pass) return alert("أدخل بيانات الدخول");

    document.querySelector('#loginSection button').innerText = 'جاري التحقق...';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', email: email, password: pass }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await response.json();
        
        if (result.success) {
            localStorage.setItem('empSession', JSON.stringify(result.data));
            checkSession();
        } else {
            showError('loginError', result.message || 'البريد أو كلمة المرور غير صحيحة');
        }
    } catch (e) {
        showError('loginError', 'فشل الاتصال بالخادم: ' + e.message);
        console.error(e);
    }
    document.querySelector('#loginSection button').innerText = 'دخول';
}

// 2. Request OTP (Registration)
async function requestOTP() {
    tempEmail = document.getElementById('regEmail').value.trim();
    if(!tempEmail) return alert("أدخل الإيميل");

    document.getElementById('btnRequestOTP').innerText = 'جاري الإرسال...';
    try {
       const res = await fetch(API_URL, {
            method:'POST', body: JSON.stringify({action:'sendOTP', email: tempEmail}), headers:{'Content-Type':'text/plain'}
       });
       const result = await res.json();
       if(result.success) {
           showSection('verifyOTPSection');
       } else {
           showError('otpError', result.message);
       }
    } catch(e) {
        showError('otpError', 'خطأ في الشبكة: ' + e.message);
        console.error(e);
    }
    document.getElementById('btnRequestOTP').innerText = 'إرسال كود التحقق';
}

// 3. Verify OTP
async function verifyOTP() {
    const code = document.getElementById('otpCode').value.trim();
    if(!code) return alert("أدخل الرمز");
    
    document.getElementById('btnVerifyOTP').innerText = 'جاري...';
    try {
       const res = await fetch(API_URL, {
            method:'POST', body: JSON.stringify({action:'verifyOTP', email: tempEmail, code: code}), headers:{'Content-Type':'text/plain'}
       });
       const result = await res.json();
       if(result.success) {
           showSection('registrationSection');
           startRegistrationVideo(); // start face registration
       } else {
           showError('verifyError', result.message);
       }
    } catch(e) {
        showError('verifyError', 'خطأ في الشبكة: ' + e.message);
        console.error(e);
    }
    document.getElementById('btnVerifyOTP').innerText = 'تأكيد الرمز';
}

// 4. Face Registration Capture
async function startRegistrationVideo() {
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    
    const video = document.getElementById('regVideo');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
        .then(stream => { video.srcObject = stream; })
        .catch(err => alert("لا يمكن الوصول للكاميرا"));
}

async function captureFaceRegistration() {
    const video = document.getElementById('regVideo');
    document.getElementById('regStatusMessage').classList.remove('hidden');
    document.getElementById('regStatusMessage').innerText = 'جاري مسح الوجه...';
    
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
    const detections = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
    if(detections) {
        registeredFaceDescriptor = Array.from(detections.descriptor);
        document.getElementById('regStatusMessage').innerText = 'تم التقاط البصمة بنجاح ✓';
        document.getElementById('regStatusMessage').className = 'success-text';
    } else {
        document.getElementById('regStatusMessage').innerText = 'لم يتم التعرف على وجه للأسف، دقق في الإضاءة.';
        document.getElementById('regStatusMessage').className = 'error-text';
    }
}

// 5. Complete Registration
async function completeRegistration() {
    const name = document.getElementById('regName').value.trim();
    const pass = document.getElementById('regPass').value.trim();
    if(!name || !pass || !registeredFaceDescriptor) {
        return showError('regError', 'أكمل بياناتك والتقط البصمة');
    }

    document.getElementById('btnCompleteReg').innerText = 'جاري الإنشاء...';
    
    // Generate Random Employee ID internally
    const newId = 'EMP' + Math.floor(1000 + Math.random() * 9000);
    
    const payload = {
        action: 'saveEmployee',
        id: newId, name: name, email: tempEmail, password: pass, phone: '', role: 'employee', assignedSites: '',
        faceDescriptor: JSON.stringify(registeredFaceDescriptor)
    };

    try {
        const res = await fetch(API_URL, {
            method:'POST', body: JSON.stringify(payload), headers:{'Content-Type':'text/plain'}
        });
        const result = await res.json();
        if(result.success) {
            alert('تم إنشاء الحساب بنجاح، سجل دخول الآن');
            location.reload();
        } else {
            showError('regError', result.message);
            document.getElementById('btnCompleteReg').innerText = 'إنشاء الحساب';
        }
    } catch(e) {
        showError('regError', 'حدث خطأ: ' + e.message);
        console.error(e);
        document.getElementById('btnCompleteReg').innerText = 'إنشاء الحساب';
    }
}

function showError(elId, msg) {
    const el = document.getElementById(elId);
    el.innerText = msg;
    el.classList.remove('hidden');
}

// -------- DASHBOARD SYSTEM --------------
function logout() {
    localStorage.removeItem('empSession');
    location.reload();
}

async function initSystem() {
    setStatus('جاري تحميل بيانات المواقع والنماذج...', 'text-muted');
    
    try {
        const response = await fetch(`${API_URL}?action=getSites`);
        const result = await response.json();
        if(result.success) sitesData = result.data;

        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

        if (currentUser.faceDescriptor) {
            const descArray = new Float32Array(JSON.parse(currentUser.faceDescriptor));
            const labeledDescriptor = new faceapi.LabeledFaceDescriptors(currentUser.name, [descArray]);
            faceMatcher = new faceapi.FaceMatcher([labeledDescriptor], 0.6);
        }

        startVideo();
        getLocation();

    } catch(e) {
        setStatus('خطأ في تهيئة النظام: ' + e.message, 'error-text');
    }
}

function setStatus(msg, className) {
    const el = document.getElementById('statusMessage');
    if(el) { el.innerText = msg; el.className = className; }
}

function startVideo() {
    const video = document.getElementById('videoElement');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
        .then(stream => { video.srcObject = stream; })
        .catch(err => setStatus('لم نتمكن من الوصول للكاميرا', 'error-text'));
    
    video.addEventListener('play', () => {
        const canvas = document.getElementById('overlay');
        const displaySize = { width: video.clientWidth, height: video.clientHeight };
        faceapi.matchDimensions(canvas, displaySize);
        
        setInterval(async () => {
            if(!faceMatcher) return;
            const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
            const detections = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
            
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            if (detections) {
                const resizeDetections = faceapi.resizeResults(detections, displaySize);
                faceapi.draw.drawDetections(canvas, resizeDetections);
                
                const bestMatch = faceMatcher.findBestMatch(detections.descriptor);
                if (bestMatch.label !== 'unknown' && lastLocation) {
                    setStatus('تم التحقق من الوجه بنجاح ✓', 'success-text');
                    currentFaceDescriptor = Array.from(detections.descriptor);
                    document.getElementById('btnCheckIn').disabled = false;
                    document.getElementById('btnCheckOut').disabled = false;
                } else if(bestMatch.label === 'unknown') {
                    setStatus('الوجه غير متطابق', 'error-text');
                    currentFaceDescriptor = null;
                    document.getElementById('btnCheckIn').disabled = true;
                    document.getElementById('btnCheckOut').disabled = true;
                }
            } else {
                setStatus('وجه الكاميرا إاليك', 'text-muted');
                currentFaceDescriptor = null;
                document.getElementById('btnCheckIn').disabled = true;
                document.getElementById('btnCheckOut').disabled = true;
            }
        }, 1000);
    });
}

function getLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(
            (position) => {
                lastLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                verifyLocation();
            },
            (error) => { setStatus('يرجى تفعيل الـ GPS', 'error-text'); },
            { enableHighAccuracy: true }
        );
    }
}

function verifyLocation() {
    if (!lastLocation || sitesData.length === 0) return;
    
    let isAtSite = false;
    let closestSite = null;

    if(!currentUser.assignedSites || currentUser.assignedSites.length === 0 || currentUser.assignedSites[0] === '') {
         // for new users they might have no site assigned. If so, fallback logic or deny.
         document.getElementById('siteText').innerText = `غير معين لأي موقع، راجع الـ HR`;
         return;
    }

    currentUser.assignedSites.forEach(siteId => {
        const site = sitesData.find(s => String(s.id) === String(siteId));
        if (site) {
            const dist = getDistanceFromLatLonInM(lastLocation.lat, lastLocation.lng, site.latitude, site.longitude);
            if (dist <= site.radius) {
                isAtSite = true;
                closestSite = site;
            }
        }
    });

    if (isAtSite) {
        document.getElementById('siteText').innerText = `متواجد في: ${closestSite.name}`;
    } else {
        document.getElementById('siteText').innerText = `خارج نطاق مواقع العمل المخصصة لك`;
        document.getElementById('btnCheckIn').disabled = true;
        document.getElementById('btnCheckOut').disabled = true;
    }
}

function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
    const R = 6371; const dLat = deg2rad(lat2-lat1);  const dLon = deg2rad(lon2-lon1); 
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(deg2rad(lat1))*Math.cos(deg2rad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c * 1000;
}
function deg2rad(deg) { return deg * (Math.PI/180) }

async function handleCheckIn() {
    if(!currentFaceDescriptor) return alert('بصمة الوجه غير ملتقطة الحين');
    if(!lastLocation) return alert('يجب تفعيل الـ GPS');

    document.getElementById('loader').classList.remove('hidden');
    const payload = {
        action: 'addAttendance', employeeId: currentUser.id, employeeName: currentUser.name,
        checkIn: new Date().toISOString(), latitude: lastLocation.lat, longitude: lastLocation.lng,
        faceDescriptor: JSON.stringify(currentFaceDescriptor)
    };

    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain' } });
        const result = await res.json();
        if(result.success) alert(result.message);
        else alert('عفواً: ' + result.message);
    } catch(e) { console.error(e); alert('حدث خطأ في الشبكة: ' + e.message); }
    document.getElementById('loader').classList.add('hidden');
}

async function handleCheckOut() {
    if(!currentFaceDescriptor) return alert('بصمة الوجه غير ملتقطة الحين');
    if(!lastLocation) return alert('يجب تفعيل الـ GPS');

    document.getElementById('loader').classList.remove('hidden');
    const payload = { 
        action: 'checkoutAttendance', employeeId: currentUser.id, 
        checkOut: new Date().toISOString(), latitude: lastLocation.lat, longitude: lastLocation.lng,
        faceDescriptor: JSON.stringify(currentFaceDescriptor)
    };
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain' } });
        const result = await res.json();
        if(result.success) alert(result.message);
        else alert('خطأ: ' + result.message);
    } catch(e) { console.error(e); alert('حدث خطأ في الشبكة: ' + e.message); }
    document.getElementById('loader').classList.add('hidden');
}

// ------ MY REPORTS SYSTEM ------ //
function showMyReports() {
    showSection('myReportsSection');
    const now = new Date();
    document.getElementById('empReportMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    fetchMyReports();
}

async function fetchMyReports() {
    const monthVal = document.getElementById('empReportMonth').value;
    if(!monthVal) return;
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        // Fetch only this employee's attendance using GET param
        const res = await fetch(`${API_URL}?action=getAttendance&employeeId=${currentUser.id}`);
        const result = await res.json();
        if(result.success) {
            renderMyReports(result.data, monthVal);
        }
    } catch(e) { console.error('خطأ في جلب التقارير', e); }
    document.getElementById('loader').classList.add('hidden');
}

function getWorkingDaysPassed(year, month) {
    let days = 0;
    const today = new Date();
    const endDay = (year === today.getFullYear() && month === today.getMonth()) ? today.getDate() : new Date(year, month + 1, 0).getDate();
    
    for (let i = 1; i <= endDay; i++) {
        const d = new Date(year, month, i);
        // Exclude Friday (5) and Saturday (6)
        if (d.getDay() !== 5 && d.getDay() !== 6) {
            days++;
        }
    }
    return days;
}

function renderMyReports(data, monthStr) {
    const targetYear = parseInt(monthStr.split('-')[0]);
    const targetMonth = parseInt(monthStr.split('-')[1]) - 1;

    const filtered = data.filter(record => {
        const d = new Date(record.checkIn);
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
    });

    let totalPresent = filtered.length;
    let totalLates = filtered.filter(r => r.status === 'late').length;
    let totalHours = 0;
    
    const tbody = document.getElementById('myReportsTableBody');
    tbody.innerHTML = '';
    
    // Reverse to show newest at top
    [...filtered].reverse().forEach(record => {
        if(record.totalHours) totalHours += parseFloat(record.totalHours);
        
        const checkInTime = new Date(record.checkIn).toLocaleString('ar-EG');
        const checkOutTime = record.checkOut ? new Date(record.checkOut).toLocaleString('ar-EG') : 'لم ينصرف بعد';
        
        tbody.innerHTML += `
            <tr>
                <td style="padding:10px; border-bottom:1px solid var(--card-border)">${new Date(record.checkIn).toLocaleDateString('ar-EG')}</td>
                <td style="padding:10px; border-bottom:1px solid var(--card-border)" dir="ltr">${new Date(record.checkIn).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}</td>
                <td style="padding:10px; border-bottom:1px solid var(--card-border)" dir="ltr">${record.checkOut ? new Date(record.checkOut).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}) : '-'}</td>
                <td style="padding:10px; border-bottom:1px solid var(--card-border)"><span style="color:${record.status==='late'?'var(--danger)':'var(--secondary)'}">${record.status==='late'?'متأخر':'حاضر'}</span></td>
            </tr>
        `;
    });

    // Calculate Absences: working days passed minus present days (simplistic logic)
    const workingDaysPassed = getWorkingDaysPassed(targetYear, targetMonth);
    let totalAbsent = workingDaysPassed - totalPresent;
    if(totalAbsent < 0) totalAbsent = 0;

    document.getElementById('empTotalPresent').innerText = totalPresent;
    document.getElementById('empTotalAbsent').innerText = totalAbsent;
    document.getElementById('empTotalLates').innerText = totalLates;
    document.getElementById('empTotalHours').innerText = totalHours.toFixed(2);
}
