const API_URL = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
let hrSession = null;
let allAttendanceData = [];
let allEmployees = []; // Added here
let allSites = [];    // Added here
let hoursChartInstance = null;
let latesChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    // Set default month/year for reports to current month
    const now = new Date();
    document.getElementById('reportMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    checkSession();
});

function checkSession() {
    const userJson = localStorage.getItem('hrSession');
    if (userJson) {
        hrSession = JSON.parse(userJson);
        document.getElementById('hrLoginSection').classList.add('hidden');
        document.getElementById('dashboardSection').classList.remove('hidden');
        initDashboard();
    }
}

async function loginHR() {
    const email = document.getElementById('hrEmail').value.trim();
    const pass = document.getElementById('hrPass').value.trim();
    if (!email || !pass) return;

    const btn = document.querySelector('#hrLoginSection .auth-form button');
    if (btn) btn.innerText = 'جاري التحقق...';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', email: email, password: pass, role: 'hr' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await response.json();
        
        if (result.success) {
            localStorage.setItem('hrSession', JSON.stringify(result.data));
            checkSession();
        } else {
            document.getElementById('loginError').innerText = result.message || 'خطأ في بيانات الدخول أو لا تملك صلاحيات HR';
            document.getElementById('loginError').classList.remove('hidden');
        }
    } catch (e) {
        document.getElementById('loginError').innerText = 'فشل الاتصال بالخادم: ' + e.message;
        document.getElementById('loginError').classList.remove('hidden');
        console.error(e);
    }
    if (btn) btn.innerText = 'دخول';
}

function logout() {
    localStorage.removeItem('hrSession');
    location.reload();
}

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tabName).classList.remove('hidden');
    event.currentTarget.classList.add('active');
    
    if (tabName === 'attendance') fetchAttendance();
    if (tabName === 'employees') fetchEmployees();
    if (tabName === 'sites') fetchSites();
    if (tabName === 'siteRequests') fetchSiteRequests();
    if (tabName === 'reports') generateReport();
    if (tabName === 'settings') fetchSettings();

    // Close sidebar on mobile after clicking a link
    const sidebar = document.querySelector('.sidebar');
    if (window.innerWidth <= 768 && sidebar.classList.contains('active')) {
        toggleSidebar();
    }
}

async function initDashboard() {
    fetchAttendance();
}

async function fetchAttendance() {
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getAttendance`);
        const result = await res.json();
        if(result.success) {
            allAttendanceData = result.data;
            renderAttendanceTable(allAttendanceData);
        }
    } catch(e) { console.error(e); }
    document.getElementById('loader').classList.add('hidden');
}

function renderAttendanceTable(data) {
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '';
    // Reverse to show newest first
    [...data].reverse().forEach(record => {
        const cInObj = new Date(record.checkIn);
        const checkInTime = !isNaN(cInObj) ? cInObj.toLocaleString('ar-EG') : (record.checkIn || '-');
        
        let checkOutTime = 'لم ينصرف بعد';
        if (record.checkOut) {
            const cOutObj = new Date(record.checkOut);
            checkOutTime = !isNaN(cOutObj) ? cOutObj.toLocaleString('ar-EG') : (record.checkOut || '-');
        }
        
        let statusText = 'حاضر';
        let statusColor = 'var(--secondary)';
        
        if (record.status === 'late') {
            statusText = 'متأخر';
            statusColor = 'var(--danger)';
        } else if (record.status === 'overtime') {
            statusText = 'عمل إضافي';
            statusColor = '#3b82f6';
        }

        tbody.innerHTML += `
            <tr>
                <td data-label="الموظف">${record.employeeName}</td>
                <td data-label="الموقع">${record.siteName}</td>
                <td data-label="وقت الحضور" dir="ltr">${checkInTime}</td>
                <td data-label="وقت الانصراف" dir="ltr">${checkOutTime}</td>
                <td data-label="إجمالي الساعات">${record.totalHours ? record.totalHours + ' ساعات' : '-'}</td>
                <td data-label="الحالة"><span style="color:${statusColor}">${statusText}</span></td>
            </tr>
        `;
    });
}

// Reports Logic
function generateReport() {
    const monthVal = document.getElementById('reportMonth').value; // YYYY-MM
    if(!monthVal || allAttendanceData.length === 0) return;
    
    const targetYear = parseInt(monthVal.split('-')[0]);
    const targetMonth = parseInt(monthVal.split('-')[1]) - 1; // 0-based

    // Filter records for the month
    const filtered = allAttendanceData.filter(record => {
        const d = new Date(record.checkIn);
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
    });

    const reportAcc = {};

    filtered.forEach(record => {
        const empId = record.employeeId;
        const recordDate = new Date(record.checkIn).toDateString(); // YYYY-MM-DD unique string
        
        if(!reportAcc[empId]) {
             reportAcc[empId] = {
                 name: record.employeeName,
                 uniqueDates: new Set(),
                 lateDates: new Set(),
                 daysPresent: 0,
                 lates: 0,
                 overtime: 0,
                 totalHours: 0
             };
        }
        
        const empStats = reportAcc[empId];
        
        if (!empStats.uniqueDates.has(recordDate)) {
            empStats.uniqueDates.add(recordDate);
            empStats.daysPresent += 1;
        }

        if(record.status === 'late') {
            if (!empStats.lateDates.has(recordDate)) {
                empStats.lateDates.add(recordDate);
                empStats.lates += 1;
            }
        }
        if(record.status === 'overtime') empStats.overtime += 1;
        if(record.totalHours) empStats.totalHours += parseFloat(record.totalHours);
    });

    // Calculate working days passed in the selected month
    const now = new Date();
    let workingDaysPassedCount = 0;
    const endDay = (targetYear === now.getFullYear() && targetMonth === now.getMonth()) 
                   ? now.getDate() 
                   : new Date(targetYear, targetMonth + 1, 0).getDate();

    for (let i = 1; i <= endDay; i++) {
        const d = new Date(targetYear, targetMonth, i);
        if (d.getDay() !== 5 && d.getDay() !== 6) { // Skip Fri/Sat
            workingDaysPassedCount++;
        }
    }

    let kpiTotalHours = 0;
    let kpiTotalLates = 0;
    let kpiActiveEmp = Object.keys(reportAcc).length;

    const names = [];
    const hours = [];
    const lates = [];

    const tbody = document.getElementById('reportsTableBody');
    tbody.innerHTML = '';

    for (let empId in reportAcc) {
        const data = reportAcc[empId];
        kpiTotalHours += data.totalHours;
        kpiTotalLates += data.lates;
        
        const absentDays = workingDaysPassedCount - data.daysPresent;
        
        names.push(data.name);
        hours.push((data.totalHours).toFixed(2));
        lates.push(data.lates);

        tbody.innerHTML += `
            <tr>
                <td data-label="ID الموظف">${empId}</td>
                <td data-label="اسم الموظف">${data.name}</td>
                <td data-label="أيام الحضور">${data.daysPresent} أيام</td>
                <td data-label="أيام الغياب"><span style="color:${absentDays > 0 ? 'var(--danger)' : 'inherit'}">${absentDays > 0 ? absentDays : 0} أيام</span></td>
                <td data-label="التأخير"><span style="color:${data.lates > 0 ? 'var(--danger)' : 'inherit'}">${data.lates} مرات</span></td>
                <td data-label="العمل الإضافي"><span style="color:#3b82f6">${data.overtime || 0} أيام</span></td>
                <td data-label="إجمالي الساعات">${data.totalHours.toFixed(2)} ساعات</td>
            </tr>
        `;
    }

    document.getElementById('kpiTotalHours').innerText = kpiTotalHours.toFixed(2);
    document.getElementById('kpiTotalLates').innerText = kpiTotalLates;
    document.getElementById('kpiActiveEmp').innerText = kpiActiveEmp;

    updateCharts(names, hours, lates);
}

function updateCharts(labels, hoursData, latesData) {
    const ctxHours = document.getElementById('hoursChart').getContext('2d');
    const ctxLates = document.getElementById('latesChart').getContext('2d');

    if(hoursChartInstance) hoursChartInstance.destroy();
    if(latesChartInstance) latesChartInstance.destroy();

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Tajawal';

    hoursChartInstance = new Chart(ctxHours, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'إجمالي الساعات',
                data: hoursData,
                backgroundColor: 'rgba(79, 70, 229, 0.7)',
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'ساعات العمل لكل موظف' } }
        }
    });

    latesChartInstance = new Chart(ctxLates, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: 'مرات التأخير',
                data: latesData,
                backgroundColor: [
                    '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#d946ef'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'نسبة التأخير بين الموظفين' } }
        }
    });
}

async function fetchEmployees() {
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getEmployees`);
        const result = await res.json();
        if(result.success) {
            allEmployees = result.data; // Store for editing
            const tbody = document.getElementById('employeesTableBody');
            tbody.innerHTML = '';
            result.data.forEach(record => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td data-label="الاسم">${record.name}</td>
                    <td data-label="البريد">${record.email}</td>
                    <td data-label="الهاتف">${record.phone || '-'}</td>
                    <td data-label="الصلاحية">${record.role}</td>
                    <td data-label="البصمة">${record.faceDescriptor ? '✅ مسجل' : '❌ لا يوجد'}</td>
                    <td data-label="الإجراءات" style="display:flex; gap:8px; justify-content:center; padding:10px;">
                        <button class="btn-primary" style="padding:5px 12px; font-size:0.85rem; width:auto;" onclick="editEmployee('${record.id}')">تعديل ✏️</button>
                        <button class="btn-danger" style="padding:5px 12px; font-size:0.85rem; width:auto; background:rgba(239,68,68,0.1); border:1px solid var(--danger); color:var(--danger);" onclick="deleteEntity('deleteEmployee', '${record.id}', '${record.name}')">حذف 🗑️</button>
                    </td>
                `;
                tbody.appendChild(row);
            });
        }
    } catch(e) { console.error(e); }
    document.getElementById('loader').classList.add('hidden');
}

async function fetchSites() {
    console.log("Fetching sites...");
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getSites`);
        const result = await res.json();
        console.log("Sites result:", result);
        if(result.success) {
            allSites = result.data;
            const tbody = document.getElementById('sitesTableBody');
            tbody.innerHTML = '';
            result.data.forEach(record => {
                console.log("Rendering site record:", record);
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td data-label="اسم الموقع">${record.name}</td>
                    <td data-label="خط العرض">${record.latitude}</td>
                    <td data-label="خط الطول">${record.longitude}</td>
                    <td data-label="النطاق">${record.radius} متر</td>
                    <td data-label="الإجراءات" style="display:flex; gap:8px; justify-content:center; padding:10px;">
                        <button class="btn-primary" style="padding:5px 12px; font-size:0.85rem; width:auto;" onclick="editSite('${record.id}')">تعديل ✏️</button>
                        <button class="btn-danger" style="padding:5px 12px; font-size:0.85rem; width:auto; background:rgba(239,68,68,0.1); border:1px solid var(--danger); color:var(--danger);" onclick="deleteEntity('deleteSite', '${record.id}', '${record.name}')">حذف 🗑️</button>
                    </td>
                `;
                tbody.appendChild(row);
            });
        }
    } catch(e) { 
        console.error("Fetch Sites Error:", e);
    }
    document.getElementById('loader').classList.add('hidden');
}

function editEmployee(id) {
    const emp = allEmployees.find(e => String(e.id) === String(id));
    if(!emp) return;
    document.getElementById('editEmpId').value = emp.id;
    document.getElementById('empModalTitle').innerText = 'تعديل بيانات موظف';
    document.getElementById('empName').value = emp.name;
    document.getElementById('empEmail').value = emp.email;
    document.getElementById('empPass').value = ''; // Don't show password for security
    document.getElementById('empRole').value = emp.role;
    document.getElementById('empSites').value = Array.isArray(emp.assignedSites) ? emp.assignedSites.join(',') : emp.assignedSites;
    openEmployeeModal();
}

function editSite(id) {
    const site = allSites.find(s => String(s.id) === String(id));
    if(!site) return;
    document.getElementById('editSiteId').value = site.id;
    document.getElementById('siteModalTitle').innerText = 'تعديل بيانات الموقع';
    document.getElementById('siteName').value = site.name;
    document.getElementById('siteMapLink').value = '';
    document.getElementById('siteLat').value = site.latitude;
    document.getElementById('siteLng').value = site.longitude;
    document.getElementById('siteRadius').value = site.radius;
    openSiteModal();
}

async function deleteEntity(action, id, name) {
    if(!confirm(`هل أنت متأكد من حذف "${name}"؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action, id }), headers:{'Content-Type':'text/plain'} });
        const result = await res.json();
        if(result.success) {
            if(action === 'deleteEmployee') fetchEmployees();
            else fetchSites();
        } else alert("خطأ في الحذف: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

function openEmployeeModal() { 
    document.getElementById('editEmpId').value = '';
    document.getElementById('empModalTitle').innerText = 'إضافة موظف جديد';
    document.getElementById('employeeModal').classList.remove('hidden'); 
}
function closeEmployeeModal() { document.getElementById('employeeModal').classList.add('hidden'); }

async function saveEmployee() {
    const editId = document.getElementById('editEmpId').value;
    const name = document.getElementById('empName').value;
    const email = document.getElementById('empEmail').value;
    const pass = document.getElementById('empPass').value;
    const role = document.getElementById('empRole').value;
    const sites = document.getElementById('empSites').value;
    
    if(!name || !email || (!editId && !pass)) return alert("أكمل البيانات");
    
    const payload = {
        action: editId ? 'updateEmployee' : 'saveEmployee',
        id: editId || ('EMP' + Math.floor(1000 + Math.random() * 9000)),
        name: name, email: email, password: pass, phone: "", role: role, assignedSites: sites
    };
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers:{'Content-Type':'text/plain'} });
        const result = await res.json();
        if(result.success) {
            closeEmployeeModal();
            fetchEmployees();
        } else alert("خطأ في الحفظ: " + result.message);
    } catch(e) {
        console.error(e);
        alert("خطأ في الاتصال: " + e.message);
    }
    document.getElementById('loader').classList.add('hidden');
}

function openSiteModal() { document.getElementById('siteModal').classList.remove('hidden'); }
function closeSiteModal() { document.getElementById('siteModal').classList.add('hidden'); }

async function parseMapLink() {
    const link = document.getElementById('siteMapLink').value.trim();
    if (!link) return;
    
    // Check if it's a short link
    if (link.includes('maps.app.goo.gl') || link.includes('goo.gl')) {
        document.getElementById('siteLat').placeholder = 'جاري استخراج البيانات...';
        document.getElementById('siteLng').placeholder = 'جاري استخراج البيانات...';
        try {
            const res = await fetch(API_URL, {
                method: 'POST', body: JSON.stringify({ action: 'resolveMapLink', link: link }), headers:{'Content-Type':'text/plain'}
            });
            const result = await res.json();
            if (result.success) {
                if (result.lat && result.lng) {
                     document.getElementById('siteLat').value = result.lat;
                     document.getElementById('siteLng').value = result.lng;
                } else if (result.url) {
                     extractLatLngFromUrl(result.url); // Fallback
                } else {
                     document.getElementById('siteLat').placeholder = 'فشل المعالجة';
                     document.getElementById('siteLng').placeholder = 'فشل المعالجة';
                }
            } else {
                throw new Error("Backend Error: " + result.message);
            }
        } catch (e) {
            console.error('Failed to resolve link', e);
            document.getElementById('siteLat').placeholder = 'فشل الاستخراج (انسخ الأرقام يدوياً)';
            document.getElementById('siteLng').placeholder = 'فشل الاستخراج (انسخ الأرقام يدوياً)';
        }
    } else {
        extractLatLngFromUrl(link);
    }
}

function extractLatLngFromUrl(url) {
    // Check for @lat,lng format
    const regex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const match = url.match(regex);
    if (match) {
        document.getElementById('siteLat').value = match[1];
        document.getElementById('siteLng').value = match[2];
    } else {
         // Check for ?q=lat,lng format
         const regexQ = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/;
         const matchQ = url.match(regexQ);
         if (matchQ) {
             document.getElementById('siteLat').value = matchQ[1];
             document.getElementById('siteLng').value = matchQ[2];
         } else {
             // Fallback for short link redirect formats that might contain place/name/lat,lng
             const regexPath = /place\/[^\/]+\/(-?\d+\.\d+),(-?\d+\.\d+)/;
             const matchPath = url.match(regexPath);
             if (matchPath) {
                 document.getElementById('siteLat').value = matchPath[1];
                 document.getElementById('siteLng').value = matchPath[2];
             }
         }
    }
}

async function saveSite() {
    const editId = document.getElementById('editSiteId').value;
    const name = document.getElementById('siteName').value.trim();
    const lat = document.getElementById('siteLat').value.trim();
    const lng = document.getElementById('siteLng').value.trim();
    const radius = document.getElementById('siteRadius').value.trim();
    
    if(!name || !lat || !lng || !radius) return alert("الرجاء إكمال كافة البيانات");
    
    const payload = {
        action: editId ? 'updateSite' : 'saveSite',
        id: editId || Math.floor(10000 + Math.random() * 90000), 
        name: name, latitude: lat, longitude: lng, radius: radius
    };
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers:{'Content-Type':'text/plain'} });
        const result = await res.json();
        if(result.success) {
            closeSiteModal();
            fetchSites();
            // Clear inputs
            document.getElementById('siteName').value = '';
            document.getElementById('siteMapLink').value = '';
            document.getElementById('siteLat').value = '';
            document.getElementById('siteLng').value = '';
            document.getElementById('siteRadius').value = '20';
        } else { alert("خطأ في الحفظ: " + (result.message||'')); }
    } catch(e) { console.error(e); alert("خطأ في الاتصال: " + e.message); }
    document.getElementById('loader').classList.add('hidden');
}

// Sidebar Toggle Logic
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('active');
    overlay.classList.toggle('show');
}

async function fetchSettings() {
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getSettings`);
        const result = await res.json();
        if (result.success) {
            // Ensure time values are in HH:mm format for input[type="time"]
            let start = result.data.workStartTime || "09:00";
            let end = result.data.workEndTime || "17:00";
            
            // Basic normalization just in case
            if (start.match(/^\d:\d\d$/)) start = "0" + start;
            if (end.match(/^\d:\d\d$/)) end = "0" + end;

            document.getElementById('setWorkStartTime').value = start;
            document.getElementById('setWorkEndTime').value = end;
        }
    } catch (e) {
        console.error("Fetch Settings error", e);
    }
    document.getElementById('loader').classList.add('hidden');
}

async function saveSettings() {
    const workStartTime = document.getElementById('setWorkStartTime').value;
    const workEndTime = document.getElementById('setWorkEndTime').value;

    if (!workStartTime || !workEndTime) {
        return alert("الرجاء تحديد كافة المواعيد");
    }

    document.getElementById('loader').classList.remove('hidden');
    try {
        const payload = {
            action: 'updateSettings',
            settings: {
                workStartTime: workStartTime,
                workEndTime: workEndTime
            }
        };

        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        
        if (result.success) {
            alert("✅ تم حفظ الإعدادات بنجاح");
        } else {
            alert("❌ خطأ: " + result.message);
        }
    } catch (e) {
        console.error("Save settings error", e);
        alert("حدث خطأ في الاتصال");
    }
    document.getElementById('loader').classList.add('hidden');
}

// ------ SITE REQUESTS LOGIC ------ //
async function fetchSiteRequests() {
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getSiteRequests`);
        const result = await res.json();
        if(result.success) {
            renderSiteRequestsTable(result.data);
        }
    } catch(e) { console.error("Fetch Site Requests error:", e); }
    document.getElementById('loader').classList.add('hidden');
}

function renderSiteRequestsTable(data) {
    const tbody = document.getElementById('siteRequestsTableBody');
    tbody.innerHTML = '';
    [...data].reverse().forEach(req => {
        let statusText = 'قيد الانتظار';
        let statusColor = 'var(--warning)';
        
        if (req.status === 'approved') {
            statusText = 'تمت الموافقة';
            statusColor = 'var(--secondary)';
        } else if (req.status === 'rejected') {
            statusText = 'مرفوض';
            statusColor = 'var(--danger)';
        }

        const actions = req.status === 'pending' ? `
            <div style="display:flex; gap:8px;">
                <button class="btn-primary" style="padding:5px 12px; font-size:0.85rem; width:auto; background:var(--secondary);" onclick="approveRequest('${req.id}', '${req.suggestedName}')">موافقة ✓</button>
                <button class="btn-danger" style="padding:5px 12px; font-size:0.85rem; width:auto;" onclick="rejectRequest('${req.id}')">رفض ✗</button>
            </div>
        ` : '-';

        const mapLinkHtml = req.mapLink ? `<a href="${req.mapLink}" target="_blank" style="color:var(--primary); text-decoration:underline;">فتح الرابط 📍</a>` : 'لا يوجد';

        const dateObj = req.timestamp ? new Date(req.timestamp) : null;
        const dateStr = (dateObj && !isNaN(dateObj)) ? dateObj.toLocaleString('ar-EG') : (req.timestamp || '-');

        tbody.innerHTML += `
            <tr>
                <td data-label="الموظف">${req.employeeName}</td>
                <td data-label="اسم الموقع المقترح">${req.suggestedName}</td>
                <td data-label="رابط الخريطة">${mapLinkHtml}</td>
                <td data-label="الإحداثيات" dir="ltr">${req.latitude}, ${req.longitude}</td>
                <td data-label="التاريخ">${dateStr}</td>
                <td data-label="الحالة"><span style="color:${statusColor}">${statusText}</span></td>
                <td data-label="الإجراءات">${actions}</td>
            </tr>
        `;
    });
}

async function approveRequest(id, suggestedName) {
    const finalName = prompt("تأكيد اسم الموقع:", suggestedName);
    if (finalName === null) return;
    const finalRadius = prompt("تحديد نطاق الحضور (بالمتر):", "20");
    if (!finalRadius) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'approveSiteRequest', id: id, name: finalName, radius: finalRadius }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            fetchSiteRequests();
        } else alert("خطأ: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

async function rejectRequest(id) {
    if(!confirm("هل أنت متأكد من رفض هذا الموقع؟")) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'rejectSiteRequest', id: id }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            fetchSiteRequests();
        } else alert("خطأ: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}
