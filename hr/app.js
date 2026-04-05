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
    if (tabName === 'reports') generateReport();
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
        const checkInTime = new Date(record.checkIn).toLocaleString('ar-EG');
        const checkOutTime = record.checkOut ? new Date(record.checkOut).toLocaleString('ar-EG') : 'لم ينصرف بعد';
        tbody.innerHTML += `
            <tr>
                <td>${record.employeeName}</td>
                <td>${record.siteName}</td>
                <td dir="ltr" style="text-align:right">${checkInTime}</td>
                <td dir="ltr" style="text-align:right">${checkOutTime}</td>
                <td>${record.totalHours ? record.totalHours + ' ساعات' : '-'}</td>
                <td><span style="color:${record.status==='late'?'var(--danger)':'var(--secondary)'}">${record.status==='late'?'متأخر':'حاضر'}</span></td>
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
        if(!reportAcc[record.employeeId]) {
             reportAcc[record.employeeId] = {
                 name: record.employeeName,
                 daysPresent: 0,
                 lates: 0,
                 totalHours: 0
             };
        }
        
        reportAcc[record.employeeId].daysPresent += 1;
        if(record.status === 'late') reportAcc[record.employeeId].lates += 1;
        if(record.totalHours) reportAcc[record.employeeId].totalHours += parseFloat(record.totalHours);
    });

    let kpiTotalHours = 0;
    let kpiTotalLates = 0;
    let kpiActiveEmp = Object.keys(reportAcc).length;

    const names = [];
    const hours = [];
    const lates = [];

    const tbody = document.getElementById('reportsTableBody');
    tbody.innerHTML = '';
    
    for (const [empId, data] of Object.entries(reportAcc)) {
        kpiTotalHours += data.totalHours;
        kpiTotalLates += data.lates;
        
        names.push(data.name);
        hours.push((data.totalHours).toFixed(2));
        lates.push(data.lates);

        tbody.innerHTML += `
            <tr>
                <td>${empId}</td>
                <td>${data.name}</td>
                <td>${data.daysPresent} أيام</td>
                <td><span style="color:${data.lates > 0 ? 'var(--danger)' : 'inherit'}">${data.lates} مرات</span></td>
                <td>${data.totalHours.toFixed(2)} ساعات</td>
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
                tbody.innerHTML += `
                    <tr>
                        <td>${record.name}</td>
                        <td>${record.email}</td>
                        <td>${record.phone || '-'}</td>
                        <td>${record.role}</td>
                        <td>${record.faceDescriptor ? '✔️ مسجل' : '❌ لا يوجد'}</td>
                        <td>
                            <button class="btn-primary" style="padding:5px 10px; font-size:0.8rem;" onclick="editEmployee('${record.id}')">تعديل</button>
                            <button class="btn-danger" style="padding:5px 10px; font-size:0.8rem; background:transparent; border:1px solid var(--danger); color:var(--danger);" onclick="deleteEntity('deleteEmployee', '${record.id}', '${record.name}')">حذف</button>
                        </td>
                    </tr>
                `;
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
                    <td>${record.name}</td>
                    <td>${record.latitude}</td>
                    <td>${record.longitude}</td>
                    <td>${record.radius} متر</td>
                    <td style="display:flex; gap:8px; justify-content:center; padding:10px;">
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
