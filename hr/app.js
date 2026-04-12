const API_URL = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
let hrSession = null;
let allAttendanceData = [];
let allEmployees = []; // Added here
let allSites = [];    // Added here
let hoursChartInstance = null;
let latesChartInstance = null;
let parseMapLinkTimer = null;
let parseMapLinkRequestId = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Set default dates
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    
    document.getElementById('attendanceDateFilter').value = todayStr;
    document.getElementById('reportStartDate').value = firstDayOfMonth;
    document.getElementById('reportEndDate').value = todayStr;
    document.getElementById('employeeReportStartDate').value = firstDayOfMonth;
    document.getElementById('employeeReportEndDate').value = todayStr;
    
    checkSession();
});

function checkSession() {
    const userJson = localStorage.getItem('hrSession');
    if (userJson) {
        hrSession = JSON.parse(userJson);
        document.getElementById('hrLoginSection').classList.add('hidden');
        document.getElementById('dashboardSection').classList.remove('hidden');
        initDashboard();
        
        // Restore active tab
        const savedTab = localStorage.getItem('hrActiveTab');
        if (savedTab) {
            showTab(savedTab);
        }
    }
}

async function loginHR() {
    const email = document.getElementById('hrIdentifier').value.trim();
    const pass = document.getElementById('hrPass').value.trim();
    if (!email || !pass) return;

    const btn = document.querySelector('#hrLoginSection .auth-form button');
    if (btn) btn.innerText = 'جاري التحقق...';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', identifier: email, password: pass, role: 'hr' }),
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
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    
    const targetTab = document.getElementById('tab-' + tabName);
    if (targetTab) targetTab.classList.remove('hidden');
    
    // Highlight the active nav button
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.getAttribute('onclick')?.includes(`'${tabName}'`)) {
            btn.classList.add('active');
        }
    });

    localStorage.setItem('hrActiveTab', tabName);
    
    if (tabName === 'attendance') fetchAttendance();
    if (tabName === 'employees') fetchEmployees();
    if (tabName === 'sites') fetchSites();
    if (tabName === 'siteRequests') fetchSiteRequests();
    if (tabName === 'reports') generateReport();
    if (tabName === 'employeeDetails') initEmployeeDetailedTab();
    if (tabName === 'settings') fetchSettings();
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
    const filterDate = document.getElementById('attendanceDateFilter').value;
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '';
    
    let filtered = data;
    if (filterDate) {
        filtered = data.filter(record => {
            const d = new Date(record.checkIn);
            return d.toISOString().split('T')[0] === filterDate;
        });
    }

    let presentToday = 0;
    let lateToday = 0;

    [...filtered].reverse().forEach(record => {
        const cInObj = new Date(record.checkIn);
        const checkInTime = !isNaN(cInObj) ? cInObj.toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}) : '-';
        
        let checkOutTime = 'نشط';
        if (record.checkOut) {
            const cOutObj = new Date(record.checkOut);
            checkOutTime = !isNaN(cOutObj) ? cOutObj.toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}) : '-';
        }

        presentToday++;
        if (record.status === 'late') lateToday++;
        
        const statusMeta = getStatusMeta(record.status);
        const statusClass = record.status === 'late' ? 'bg-error/10 text-error' : (record.status === 'overtime' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary');

        tbody.innerHTML += `
            <tr class="hover:bg-surface-container/50 transition-colors group">
                <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-[10px] font-black">${record.employeeName.substring(0,2)}</div>
                        <span class="font-bold text-sm">${record.employeeName}</span>
                    </div>
                </td>
                <td class="px-6 py-4 text-sm text-on-surface-variant">${record.siteName}</td>
                <td class="px-6 py-4 text-sm font-bold" dir="ltr">${checkInTime}</td>
                <td class="px-6 py-4 text-sm text-on-surface-variant font-medium" dir="ltr">${checkOutTime}</td>
                <td class="px-6 py-4 text-sm font-black text-primary">${record.totalHours && !isNaN(parseFloat(record.totalHours)) ? parseFloat(record.totalHours).toFixed(2) : '-'}</td>
                <td class="px-6 py-4 text-sm font-bold">${record.transportPrice || 0} ج.م</td>
                <td class="px-6 py-4">
                    <span class="status-pill ${statusClass}">${statusMeta.text}</span>
                </td>
            </tr>
        `;
    });

    if (document.getElementById('statPresentToday')) document.getElementById('statPresentToday').innerText = presentToday;
    if (document.getElementById('statLateToday')) document.getElementById('statLateToday').innerText = lateToday;
}

function getWorkingDaysCount(startDate, endDate) {
    let workingDaysCount = 0;
    const tempDate = new Date(startDate);
    tempDate.setHours(0, 0, 0, 0);

    const finalDate = new Date(endDate);
    finalDate.setHours(23, 59, 59, 999);

    while (tempDate <= finalDate) {
        if (tempDate.getDay() !== 5 && tempDate.getDay() !== 6) {
            workingDaysCount += 1;
        }
        tempDate.setDate(tempDate.getDate() + 1);
    }
    return workingDaysCount;
}

function toTransportNumber(value) {
    const parsed = parseFloat(value || 0);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function calculateUniqueDailyTransport(records) {
    const dailyTransport = {};
    records.forEach(record => {
        const dateObj = new Date(record.checkIn);
        if (Number.isNaN(dateObj.getTime())) return;

        const dayKey = `${String(record.employeeId || '')}|${dateObj.toDateString()}`;
        const transportValue = toTransportNumber(record.transportPrice);

        if (!(dayKey in dailyTransport)) {
            dailyTransport[dayKey] = transportValue;
        } else if (transportValue > dailyTransport[dayKey]) {
            dailyTransport[dayKey] = transportValue;
        }
    });

    return Object.values(dailyTransport).reduce((sum, value) => sum + value, 0);
}

function getStatusMeta(status) {
    if (status === 'late') return { text: 'متأخر', color: '#ffb4ab' };
    if (status === 'overtime') return { text: 'إضافي', color: '#adc6ff' };
    return { text: 'حاضر', color: '#b7c8e1' };
}

function resetEmployeeDetailedReportView(message) {
    document.getElementById('employeeDetailPresent').innerText = '0';
    document.getElementById('employeeDetailAbsent').innerText = '0';
    document.getElementById('employeeDetailLate').innerText = '0';
    document.getElementById('employeeDetailHours').innerText = '0.00';
    document.getElementById('employeeDetailTransport').innerText = '0.00';
    document.getElementById('employeeDetailMeta').innerText = message || 'اختر موظفًا وحدد الفترة الزمنية ثم اضغط "عرض التقرير".';

    const tbody = document.getElementById('employeeDetailTableBody');
    if (!tbody) return;
    tbody.innerHTML = `
        <tr>
            <td colspan="7" class="employee-report-empty">لا توجد بيانات معروضة بعد.</td>
        </tr>
    `;
}

function populateEmployeeDetailEmployees() {
    const select = document.getElementById('employeeDetailEmployee');
    if (!select) return;

    const currentValue = select.value;
    const sortedEmployees = [...allEmployees].sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), 'ar')
    );

    select.innerHTML = '<option value="">اختر موظف</option>';
    sortedEmployees.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.name} (${emp.id})`;
        select.appendChild(option);
    });

    if (currentValue && sortedEmployees.some(emp => String(emp.id) === String(currentValue))) {
        select.value = currentValue;
    }
}

async function initEmployeeDetailedTab() {
    if (!allEmployees.length) await fetchEmployees();
    if (!allAttendanceData.length) await fetchAttendance();
    populateEmployeeDetailEmployees();

    const selectedEmployee = document.getElementById('employeeDetailEmployee').value;
    if (selectedEmployee) {
        await generateEmployeeDetailedReport();
    } else {
        resetEmployeeDetailedReportView();
    }
}

async function generateEmployeeDetailedReport() {
    const employeeSelect = document.getElementById('employeeDetailEmployee');
    const employeeId = employeeSelect.value;
    const startStr = document.getElementById('employeeReportStartDate').value;
    const endStr = document.getElementById('employeeReportEndDate').value;

    if (!employeeId) return alert('يرجى اختيار الموظف أولًا');
    if (!startStr || !endStr) return alert('يرجى اختيار الفترة الزمنية أولًا');

    const startDate = new Date(startStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endStr);
    endDate.setHours(23, 59, 59, 999);

    if (startDate > endDate) return alert('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');

    if (!allAttendanceData.length) {
        await fetchAttendance();
    }

    const employeeRecords = allAttendanceData.filter(record => {
        const checkInDate = new Date(record.checkIn);
        if (isNaN(checkInDate)) return false;
        return String(record.employeeId) === String(employeeId) && checkInDate >= startDate && checkInDate <= endDate;
    });

    const sortedRecords = [...employeeRecords].sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn));
    const presentDates = new Set();
    const lateDates = new Set();
    let totalHours = 0;
    let totalTransport = 0;

    sortedRecords.forEach(record => {
        const recordDate = new Date(record.checkIn);
        const dateKey = !isNaN(recordDate) ? recordDate.toDateString() : null;
        if (dateKey) {
            presentDates.add(dateKey);
            if (record.status === 'late') lateDates.add(dateKey);
        }

        const parsedHours = parseFloat(record.totalHours || 0);
        if (!isNaN(parsedHours)) totalHours += parsedHours;
    });

    totalTransport = calculateUniqueDailyTransport(sortedRecords);

    const workingDaysCount = getWorkingDaysCount(startDate, endDate);
    const daysPresent = presentDates.size;
    const daysAbsent = Math.max(workingDaysCount - daysPresent, 0);

    document.getElementById('employeeDetailPresent').innerText = String(daysPresent);
    document.getElementById('employeeDetailAbsent').innerText = String(daysAbsent);
    document.getElementById('employeeDetailLate').innerText = String(lateDates.size);
    document.getElementById('employeeDetailHours').innerText = totalHours.toFixed(2);
    document.getElementById('employeeDetailTransport').innerText = totalTransport.toFixed(2);

    const selectedLabel = employeeSelect.options[employeeSelect.selectedIndex]
        ? employeeSelect.options[employeeSelect.selectedIndex].textContent
        : employeeId;
    const employeeName = selectedLabel.replace(/\s*\(.+\)\s*$/, '').trim() || selectedLabel;
    document.getElementById('employeeDetailMeta').innerText =
        `الموظف: ${employeeName} | الفترة: ${startDate.toLocaleDateString('ar-EG')} - ${endDate.toLocaleDateString('ar-EG')} | عدد العمليات: ${sortedRecords.length}`;

    const tbody = document.getElementById('employeeDetailTableBody');
    if (sortedRecords.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="employee-report-empty">لا توجد عمليات لهذا الموظف خلال الفترة المحددة.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';
    sortedRecords.forEach(record => {
        const checkInObj = new Date(record.checkIn);
        const dateText = !isNaN(checkInObj) ? checkInObj.toLocaleDateString('ar-EG') : '-';
        const checkInText = !isNaN(checkInObj)
            ? checkInObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
            : (record.checkIn || '-');

        let checkOutText = 'نشط';
        if (record.checkOut) {
            const checkOutObj = new Date(record.checkOut);
            checkOutText = !isNaN(checkOutObj)
                ? checkOutObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                : (record.checkOut || '-');
        }

        const statusMeta = getStatusMeta(record.status);
        const statusClass = record.status === 'late' ? 'bg-error/10 text-error' : (record.status === 'overtime' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary');
        const parsedHours = parseFloat(record.totalHours);
        const hoursText = !isNaN(parsedHours) ? `${parsedHours.toFixed(2)}` : '-';
        const parsedTransport = parseFloat(record.transportPrice || 0);
        const transportText = `${isNaN(parsedTransport) ? 0 : parsedTransport.toFixed(2)} ج.م`;

        tbody.innerHTML += `
            <tr class="hover:bg-surface-container/30 transition-colors">
                <td class="px-6 py-4 text-sm font-bold text-on-surface">${dateText}</td>
                <td class="px-6 py-4 text-sm text-on-surface-variant">${record.siteName || '-'}</td>
                <td class="px-6 py-4 text-sm font-medium" dir="ltr">${checkInText}</td>
                <td class="px-6 py-4 text-sm font-medium text-on-surface-variant" dir="ltr">${checkOutText}</td>
                <td class="px-6 py-4 text-center"><span class="status-pill ${statusClass}">${statusMeta.text}</span></td>
                <td class="px-6 py-4 text-sm font-black text-primary">${hoursText}</td>
                <td class="px-6 py-4 text-sm font-bold">${transportText}</td>
            </tr>
        `;
    });
}

async function sendEmployeeDetailedReport() {
    const employeeSelect = document.getElementById('employeeDetailEmployee');
    const employeeId = employeeSelect.value;
    const startStr = document.getElementById('employeeReportStartDate').value;
    const endStr = document.getElementById('employeeReportEndDate').value;
    const customEmail = document.getElementById('employeeReportEmail').value.trim();

    if (!employeeId) return alert('يرجى اختيار الموظف أولًا');
    if (!startStr || !endStr) return alert('يرجى اختيار الفترة الزمنية أولًا');

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    if (startDate > endDate) return alert('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');

    const selectedLabel = employeeSelect.options[employeeSelect.selectedIndex]
        ? employeeSelect.options[employeeSelect.selectedIndex].textContent
        : employeeId;
    const employeeName = selectedLabel.replace(/\s*\(.+\)\s*$/, '').trim() || selectedLabel;

    const receiverText = customEmail ? `إلى: ${customEmail}` : 'إلى الإيميلات المسجلة في الإعدادات';
    if (!confirm(`هل تريد إرسال التقرير التفصيلي للموظف "${employeeName}" ${receiverText}؟`)) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'sendEmployeeDetailedReport',
                employeeId: employeeId,
                employeeName: employeeName,
                startDate: startStr,
                endDate: endStr,
                email: customEmail
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        alert(result.success ? (result.message || '✅ تم إرسال التقرير بنجاح') : `❌ فشل الإرسال: ${result.message}`);
    } catch (e) {
        console.error(e);
        alert('حدث خطأ في الاتصال أثناء إرسال التقرير');
    }
    document.getElementById('loader').classList.add('hidden');
}

// Reports Logic
function generateReport() {
    const startStr = document.getElementById('reportStartDate').value;
    const endStr = document.getElementById('reportEndDate').value;
    
    if(!startStr || !endStr || allAttendanceData.length === 0) return;
    
    const startDate = new Date(startStr);
    startDate.setHours(0,0,0,0);
    const endDate = new Date(endStr);
    endDate.setHours(23,59,59,999);

    // Filter records for the range
    const filtered = allAttendanceData.filter(record => {
        const d = new Date(record.checkIn);
        return d >= startDate && d <= endDate;
    });

    const reportAcc = {};

    filtered.forEach(record => {
        const empId = record.employeeId;
        const recordDate = new Date(record.checkIn).toDateString(); 
        
        if(!reportAcc[empId]) {
             reportAcc[empId] = {
                 name: record.employeeName,
                 uniqueDates: new Set(),
                 lateDates: new Set(),
                 transportByDate: {},
                 daysPresent: 0,
                 lates: 0,
                 overtime: 0,
                 totalHours: 0,
                 totalTransport: 0
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
        const transportValue = toTransportNumber(record.transportPrice);
        if (!(recordDate in empStats.transportByDate)) {
            empStats.transportByDate[recordDate] = transportValue;
        } else if (transportValue > empStats.transportByDate[recordDate]) {
            empStats.transportByDate[recordDate] = transportValue;
        }
    });

    Object.keys(reportAcc).forEach(empId => {
        const map = reportAcc[empId].transportByDate;
        reportAcc[empId].totalTransport = Object.values(map).reduce((sum, value) => sum + value, 0);
    });

    // Calculate working days passed in the selected range
    const workingDaysCount = getWorkingDaysCount(startDate, endDate);

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
        
        const absentDays = workingDaysCount - data.daysPresent;
        
        names.push(data.name);
        hours.push((data.totalHours).toFixed(2));
        lates.push(data.lates);

        tbody.innerHTML += `
            <tr class="hover:bg-surface-container/30 transition-colors">
                <td class="px-6 py-4 text-xs font-black text-on-surface-variant uppercase">${empId}</td>
                <td class="px-6 py-4 font-bold text-on-surface">${data.name}</td>
                <td class="px-6 py-4 text-sm font-bold text-primary">${data.daysPresent} يوم</td>
                <td class="px-6 py-4 text-sm font-bold ${absentDays > 0 ? 'text-error' : 'text-on-surface-variant'}">${absentDays > 0 ? absentDays : 0} يوم</td>
                <td class="px-6 py-4 text-sm font-bold ${data.lates > 0 ? 'text-tertiary' : 'text-on-surface-variant'}">${data.lates} مرة</td>
                <td class="px-6 py-4 text-sm font-bold text-on-surface-variant">${data.overtime || 0}</td>
                <td class="px-6 py-4 text-sm font-black text-on-surface">${data.totalTransport.toFixed(2)} ج.م</td>
                <td class="px-6 py-4 text-sm font-black text-primary animate-pulse">${data.totalHours.toFixed(2)}</td>
            </tr>
        `;
    }

    document.getElementById('kpiTotalHours').innerText = kpiTotalHours.toFixed(2);
    document.getElementById('kpiTotalLates').innerText = kpiTotalLates;
    document.getElementById('kpiActiveEmp').innerText = kpiActiveEmp;

    updateCharts(names, hours, lates);
}

async function sendCustomReport() {
    const startStr = document.getElementById('reportStartDate').value;
    const endStr = document.getElementById('reportEndDate').value;
    
    if(!startStr || !endStr) return alert("يرجى اختيار الفترة الزمنية أولاً");

    if(!confirm("هل تريد إرسال هذا التقرير للإيميلات المسجلة في الإعدادات؟")) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                action: 'sendManualReport', 
                startDate: startStr, 
                endDate: endStr 
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        alert(result.success ? "✅ تم إرسال التقرير بنجاح" : "❌ فشل الإرسال: " + result.message);
    } catch(e) { alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

function updateCharts(labels, hoursData, latesData) {
    const ctxHours = document.getElementById('hoursChart').getContext('2d');
    const ctxLates = document.getElementById('latesChart').getContext('2d');

    if(hoursChartInstance) hoursChartInstance.destroy();
    if(latesChartInstance) latesChartInstance.destroy();

    Chart.defaults.color = '#c3c5d9';
    Chart.defaults.font.family = 'Noto Kufi Arabic, Inter';

    hoursChartInstance = new Chart(ctxHours, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'إجمالي الساعات',
                data: hoursData,
                backgroundColor: 'rgba(0, 98, 208, 0.7)',
                borderColor: '#adc6ff',
                borderWidth: 2,
                borderRadius: 8,
                hoverBackgroundColor: '#adc6ff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
                x: { grid: { display: false }, border: { display: false } }
            }
        }
    });

    latesChartInstance = new Chart(ctxLates, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: latesData,
                backgroundColor: ['#adc6ff', '#ffb4a1', '#b7c8e1', '#d3e4fe', '#ffdbd2'],
                borderWidth: 4,
                borderColor: '#171f33',
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } }
            }
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
            populateEmployeeDetailEmployees();
            const tbody = document.getElementById('employeesTableBody');
            tbody.innerHTML = '';
            result.data.forEach(record => {
                const row = document.createElement('tr');
                row.className = "hover:bg-surface-container/30 transition-colors";
                row.innerHTML = `
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">${record.name.substring(0,1)}</div>
                            <span class="font-bold text-on-surface">${record.name}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-sm text-on-surface-variant">${record.email}</td>
                    <td class="px-6 py-4 text-sm text-on-surface-variant">${record.phone || '-'}</td>
                    <td class="px-6 py-4"><span class="px-3 py-1 bg-surface-container-high rounded-full text-[10px] font-black uppercase text-on-surface-variant">${record.role}</span></td>
                    <td class="px-6 py-4">
                        <div class="flex items-center justify-center gap-2">
                            <button class="p-2 hover:bg-primary/10 text-primary rounded-xl transition-colors" onclick="editEmployee('${record.id}')"><span class="material-symbols-outlined">edit</span></button>
                            <button class="p-2 hover:bg-error/10 text-error rounded-xl transition-colors" onclick="deleteEntity('deleteEmployee', '${record.id}', '${record.name}')"><span class="material-symbols-outlined">delete</span></button>
                        </div>
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
                const isTemporary = Boolean(record.isTemporary);
                const row = document.createElement('tr');
                row.className = "hover:bg-surface-container/30 transition-colors";
                row.innerHTML = `
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary"><span class="material-symbols-outlined text-sm">location_on</span></div>
                            <span class="font-bold text-on-surface">${record.name} ${isTemporary ? '<span class="text-[10px] text-tertiary">(مؤقت)</span>' : ''}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-xs font-mono text-on-surface-variant">${record.latitude}</td>
                    <td class="px-6 py-4 text-xs font-mono text-on-surface-variant">${record.longitude}</td>
                    <td class="px-6 py-4 text-sm font-black text-secondary">${record.radius}م</td>
                    <td class="px-6 py-4">
                        <div class="flex items-center justify-center gap-2">
                            ${!isTemporary ? `<button class="p-2 hover:bg-primary/10 text-primary rounded-xl" onclick="editSite('${record.id}')"><span class="material-symbols-outlined">edit</span></button>
                            <button class="p-2 hover:bg-error/10 text-error rounded-xl" onclick="deleteEntity('deleteSite', '${record.id}', '${record.name}')"><span class="material-symbols-outlined">delete</span></button>` : '-'}
                        </div>
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

async function editEmployee(id) {
    const emp = allEmployees.find(e => String(e.id) === String(id));
    if(!emp) return;
    document.getElementById('editEmpId').value = emp.id;
    document.getElementById('empModalTitle').innerText = 'تعديل بيانات موظف';
    document.getElementById('empName').value = emp.name;
    document.getElementById('empEmail').value = emp.email;
    document.getElementById('empPhone').value = emp.phone || '';
    document.getElementById('empPass').value = ''; // Don't show password for security
    document.getElementById('empPass').placeholder = 'اتركها فارغة للاحتفاظ بكلمة المرور الحالية';
    document.getElementById('empRole').value = emp.role;
    document.getElementById('empRole').value = emp.role;
    document.getElementById('empTransportPrice').value = emp.transportPrice || 0;
    
    // Assigned sites (can keep for compatibility or just use for initialization)
    const assigned = Array.isArray(emp.assignedSites) ? emp.assignedSites : (emp.assignedSites ? String(emp.assignedSites).split(',') : []);
    document.getElementById('empSites').value = assigned.join(',');
    
    await openEmployeeModal('edit', emp);
}

function editSite(id) {
    const site = allSites.find(s => String(s.id) === String(id));
    if(!site) return;
    if (site.isTemporary) {
        alert('هذا موقع مؤقت (موافقة اليوم فقط) ولا يمكن تعديله من إدارة المواقع.');
        return;
    }
    document.getElementById('editSiteId').value = site.id;
    document.getElementById('siteModalTitle').innerText = 'تعديل بيانات الموقع';
    document.getElementById('siteName').value = site.name;
    document.getElementById('siteMapLink').value = '';
    document.getElementById('siteLat').value = site.latitude;
    document.getElementById('siteLng').value = site.longitude;
    document.getElementById('siteRadius').value = site.radius;
    openSiteModal();
}

function toggleAdvancedEmpOptions() {
    const el = document.getElementById('advancedEmpOptions');
    el.classList.toggle('hidden');
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

async function openEmployeeModal(mode = 'add', emp = null) {
    if (mode !== 'edit') {
        document.getElementById('editEmpId').value = '';
        document.getElementById('empModalTitle').innerText = 'إضافة موظف جديد';
        document.getElementById('empName').value = '';
        document.getElementById('empEmail').value = '';
        document.getElementById('empPhone').value = '';
        document.getElementById('empPass').value = '';
        document.getElementById('empPass').placeholder = 'اختياري: سيتم توليد كلمة مرور مؤقتة تلقائيًا';
        document.getElementById('empRole').value = 'employee';
        document.getElementById('empTransportPrice').value = 0;
        document.getElementById('empSites').value = '';
        document.getElementById('advancedEmpOptions').classList.add('hidden');
    }

    // Render Sites List
    const container = document.getElementById('empSitesContainer');
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center;">جاري تحميل المواقع...</div>';
    
    if (!allSites.length) {
        await fetchSites();
    }

    container.innerHTML = '';
    allSites.filter(s => !s.isTemporary).forEach(site => {
        const isAssigned = emp && emp.assignedSites && emp.assignedSites.includes(String(site.id));
        const allowance = emp && emp.siteAllowances ? emp.siteAllowances.find(a => String(a.siteId) === String(site.id)) : null;
        const price = allowance ? allowance.transportPrice : (site.transportPrice || 0);

        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '10px';
        div.style.marginBottom = '8px';
        div.style.padding = '5px';
        div.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

        div.innerHTML = `
            <input type="checkbox" class="site-checkbox" value="${site.id}" ${isAssigned ? 'checked' : ''} style="width:18px; height:18px;">
            <span style="flex:1; font-size:0.9rem;">${site.name}</span>
            <div style="display:flex; align-items:center; gap:5px;">
                <input type="number" class="site-price-input" data-site-id="${site.id}" value="${price}" 
                    style="width:70px; padding:4px; border-radius:4px; background:rgba(0,0,0,0.3); border:1px solid var(--card-border); color:white; font-size:0.85rem;"
                    ${!isAssigned ? 'disabled' : ''}>
                <span style="font-size:0.75rem; color:var(--text-muted);">ج.م</span>
            </div>
        `;

        // Toggle price input based on checkbox
        const checkbox = div.querySelector('.site-checkbox');
        const priceInput = div.querySelector('.site-price-input');
        checkbox.addEventListener('change', () => {
            priceInput.disabled = !checkbox.checked;
        });

        container.appendChild(div);
    });

    if (!allSites.length) {
        container.innerHTML = '<div style="color: var(--danger); font-size: 0.85rem; text-align: center;">لم يتم العثور على مواقع.</div>';
    }

    document.getElementById('employeeModal').classList.remove('hidden');
}
function closeEmployeeModal() { document.getElementById('employeeModal').classList.add('hidden'); }

async function saveEmployee() {
    const editId = document.getElementById('editEmpId').value;
    const name = document.getElementById('empName').value.trim();
    const email = document.getElementById('empEmail').value.trim();
    const phone = document.getElementById('empPhone').value.trim();
    const pass = document.getElementById('empPass').value.trim();
    const role = document.getElementById('empRole').value;
    
    // Collect sites and allowances
    const selectedSites = [];
    const siteAllowances = [];
    
    document.querySelectorAll('#empSitesContainer > div').forEach(div => {
        const checkbox = div.querySelector('.site-checkbox');
        const priceInput = div.querySelector('.site-price-input');
        if (checkbox.checked) {
            const siteId = checkbox.value;
            const price = parseFloat(priceInput.value) || 0;
            selectedSites.push(siteId);
            siteAllowances.push({ siteId, transportPrice: price });
        }
    });

    if(!phone) return alert("أدخل رقم الهاتف");
    if(!name || !email) return alert("أكمل البيانات");
    
    const autoGeneratedPassword = (!editId && !pass)
        ? ('TMP' + Math.floor(100000 + Math.random() * 900000))
        : '';
    
    const payload = {
        action: editId ? 'updateEmployee' : 'saveEmployee',
        id: editId || ('EMP' + Math.floor(1000 + Math.random() * 9000)),
        name: name, 
        email: email, 
        password: pass || autoGeneratedPassword, 
        phone: phone, 
        role: role, 
        assignedSites: selectedSites.join(','),
        siteAllowances: siteAllowances,
        transportPrice: document.getElementById('empTransportPrice').value || 0
    };
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers:{'Content-Type':'text/plain'} });
        const result = await res.json();
        if(result.success) {
            if (autoGeneratedPassword) {
                alert(`تم إنشاء كلمة مرور مؤقتة تلقائيًا: ${autoGeneratedPassword}`);
            }
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

function parseMapLink() {
    if (parseMapLinkTimer) clearTimeout(parseMapLinkTimer);
    parseMapLinkTimer = setTimeout(runParseMapLink, 300);
}

async function runParseMapLink() {
    const link = document.getElementById('siteMapLink').value.trim();
    const latInput = document.getElementById('siteLat');
    const lngInput = document.getElementById('siteLng');

    if (!link) {
        latInput.placeholder = 'تلقائي عبر الرابط';
        lngInput.placeholder = 'تلقائي عبر الرابط';
        return;
    }

    const currentRequestId = ++parseMapLinkRequestId;
    latInput.value = '';
    lngInput.value = '';
    latInput.placeholder = 'جاري استخراج البيانات...';
    lngInput.placeholder = 'جاري استخراج البيانات...';

    let extracted = extractLatLngFromUrl(link);
    const shouldAskBackend = link.includes('maps.app.goo.gl') || link.includes('goo.gl') || link.includes('google.com/maps');

    if (!extracted && shouldAskBackend) {
        try {
            const res = await fetch(API_URL, {
                method: 'POST', body: JSON.stringify({ action: 'resolveMapLink', link: link }), headers:{'Content-Type':'text/plain'}
            });
            const result = await res.json();
            if (currentRequestId !== parseMapLinkRequestId) return;

            if (result.success) {
                if (result.lat && result.lng) {
                    extracted = { lat: String(result.lat), lng: String(result.lng) };
                } else if (result.url) {
                    extracted = extractLatLngFromUrl(result.url);
                }
            } else {
                throw new Error('Backend Error: ' + result.message);
            }
        } catch (e) {
            console.error('Failed to resolve link', e);
        }
    }

    if (currentRequestId !== parseMapLinkRequestId) return;

    if (extracted) {
        latInput.value = extracted.lat;
        lngInput.value = extracted.lng;
        latInput.placeholder = 'تلقائي عبر الرابط';
        lngInput.placeholder = 'تلقائي عبر الرابط';
        return;
    }

    latInput.placeholder = 'فشل الاستخراج (انسخ الأرقام يدوياً)';
    lngInput.placeholder = 'فشل الاستخراج (انسخ الأرقام يدوياً)';
}

function extractLatLngFromUrl(url) {
    if (!url) return null;

    const candidates = [String(url)];
    try {
        const decoded = decodeURIComponent(String(url));
        if (decoded !== url) candidates.push(decoded);
        const decodedTwice = decodeURIComponent(decoded);
        if (decodedTwice !== decoded && decodedTwice !== url) candidates.push(decodedTwice);
    } catch (e) {}

    const patterns = [
        /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
        /[?&]q=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
        /[?&]query=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
        /center=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
        /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
        /place\/[^\/]+\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i
    ];

    for (const candidate of candidates) {
        for (const pattern of patterns) {
            const match = candidate.match(pattern);
            if (!match) continue;
            const lat = parseFloat(match[1]);
            const lng = parseFloat(match[2]);
            if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
                return { lat: String(lat), lng: String(lng) };
            }
        }
    }

    return null;
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
            
            // Reports settings
            document.getElementById('setReportEmails').value = result.data.reportEmails || "";
            document.getElementById('setDailyReport').checked = result.data.dailyReportEnabled === "true";
            document.getElementById('setMonthlyReport').checked = result.data.monthlyReportEnabled === "true";
        }
    } catch (e) {
        console.error("Fetch Settings error", e);
    }
    document.getElementById('loader').classList.add('hidden');
}

async function saveSettings() {
    const workStartTime = document.getElementById('setWorkStartTime').value;
    const workEndTime = document.getElementById('setWorkEndTime').value;
    const reportEmails = document.getElementById('setReportEmails').value;
    const dailyEnabled = document.getElementById('setDailyReport').checked;
    const monthlyEnabled = document.getElementById('setMonthlyReport').checked;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const payload = {
            action: 'updateSettings',
            settings: {
                workStartTime: workStartTime,
                workEndTime: workEndTime,
                reportEmails: reportEmails,
                dailyReportEnabled: dailyEnabled ? "true" : "false",
                monthlyReportEnabled: monthlyEnabled ? "true" : "false"
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

async function setupTriggers() {
    if(!confirm("سيتم الآن تفعيل مواعيد إرسال التقارير التلقائية. هل أنت متأكد؟")) return;
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'createTriggers' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        alert(result.success ? "✅ تم تفعيل المواعيد بنجاح" : "❌ فشل التفعيل");
    } catch(e) { alert("خطأ في الاتصال"); }
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
        let statusText = 'انتظار';
        let statusClass = 'bg-primary-container/10 text-primary';

        if (req.status === 'approved') {
            statusText = 'دائم';
            statusClass = 'bg-secondary/10 text-secondary';
        } else if (req.status === 'approved_today') {
            statusText = req.isActiveToday ? 'نشط اليوم' : 'منتهي';
            statusClass = req.isActiveToday ? 'bg-primary/10 text-primary' : 'bg-surface-container-highest text-on-surface-variant';
        } else if (req.status === 'rejected') {
            statusText = 'مرفوض';
            statusClass = 'bg-error/10 text-error';
        }

        const actions = req.status === 'pending' ? `
            <div class="flex items-center justify-center gap-2">
                <button class="px-3 py-1.5 bg-secondary text-on-secondary text-[10px] font-black rounded-lg shadow-sm" onclick="approveRequest('${req.id}', '${req.suggestedName}')">موافقة</button>
                <button class="px-3 py-1.5 bg-error text-on-error text-[10px] font-black rounded-lg shadow-sm" onclick="rejectRequest('${req.id}')">رفض</button>
            </div>
        ` : '-';

        const dateObj = req.timestamp ? new Date(req.timestamp) : null;
        const createdStr = (dateObj && !isNaN(dateObj)) ? dateObj.toLocaleDateString('ar-EG') : '-';

        tbody.innerHTML += `
            <tr class="hover:bg-surface-container/30 transition-colors">
                <td class="px-6 py-4 font-bold text-sm">${req.employeeName}</td>
                <td class="px-6 py-4 text-sm font-medium">
                    <div class="flex flex-col">
                        <span>${req.suggestedName}</span>
                        ${req.mapLink ? `<a href="${req.mapLink}" target="_blank" class="text-[10px] text-primary hover:underline">موقع الخريطة 📍</a>` : ''}
                    </div>
                </td>
                <td class="px-6 py-4 text-xs text-on-surface-variant font-medium">${createdStr}</td>
                <td class="px-6 py-4"><span class="status-pill ${statusClass}">${statusText}</span></td>
                <td class="px-6 py-4 text-center">${actions}</td>
            </tr>
        `;
    });
}
async function approveRequest(id, suggestedName) {
    document.getElementById('approveReqId').value = id;
    document.getElementById('approveSiteName').value = suggestedName;
    document.getElementById('approveTransportPrice').value = 120;
    document.getElementById('approveRadius').value = 100;
    document.getElementById('approveRequestModal').classList.remove('hidden');
}

function closeApproveModal() {
    document.getElementById('approveRequestModal').classList.add('hidden');
}

async function confirmApproval(mode) {
    const id = document.getElementById('approveReqId').value;
    const name = document.getElementById('approveSiteName').value;
    const transportPrice = document.getElementById('approveTransportPrice').value;
    const radius = document.getElementById('approveRadius').value;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                action: 'approveSiteRequest', 
                id: id, 
                name: name, 
                transportPrice: transportPrice, 
                radius: radius,
                mode: mode 
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            closeApproveModal();
            fetchSiteRequests();
            fetchSites();
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

