/////////////////////////////
// 🔥 CONFIG
/////////////////////////////
var FACE_THRESHOLD = 0.6;

/////////////////////////////
// 🔥 GET SPREADSHEET
/////////////////////////////
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/////////////////////////////
// 🔥 AUTO CREATE SHEETS
/////////////////////////////
function getOrCreateSheet(name, headers) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) sheet.appendRow(headers);
  }
  return sheet;
}

/////////////////////////////
// 🔥 DISTANCE
/////////////////////////////
function getDistance(lat1, lon1, lat2, lon2) {
  var R = 6371e3;
  var f1 = lat1 * Math.PI/180;
  var f2 = lat2 * Math.PI/180;
  var df = (lat2-lat1) * Math.PI/180;
  var dl = (lon2-lon1) * Math.PI/180;

  var a = Math.sin(df/2)**2 +
          Math.cos(f1)*Math.cos(f2) *
          Math.sin(dl/2)**2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/////////////////////////////
// 🔥 FACE DISTANCE
/////////////////////////////
function getFaceDistance(a, b) {
  if (!a || !b || a.length !== 128 || b.length !== 128) return 1;
  var sum = 0;
  for (var i=0;i<128;i++) sum += Math.pow(a[i]-b[i],2);
  return Math.sqrt(sum);
}

/////////////////////////////
// 🔥 VALIDATION
/////////////////////////////
function validateAll(ss, data) {

  var empSheet = getOrCreateSheet("employees",
    ["id","name","email","password","phone","role","assignedSites","faceDescriptor"]
  );

  var empRows = empSheet.getDataRange().getValues();
  empRows.shift();

  var user = empRows.find(function(r) { return r[0] == data.employeeId; });
  if (!user) throw new Error("الموظف غير موجود");

  // FACE CHECK
  if (user[7] && data.faceDescriptor) {
    var dist = getFaceDistance(
      JSON.parse(user[7]),
      JSON.parse(data.faceDescriptor)
    );
    if (dist > FACE_THRESHOLD) throw new Error("بصمة الوجه غير متطابقة");
  } else if (user[7] && !data.faceDescriptor) {
    throw new Error("مطلوب توثيق بصمة الوجه للعملية");
  }

  // GPS CHECK
  if (!data.latitude || !data.longitude) throw new Error("يجب توفير إحداثيات الموقع (GPS)");

  var sitesSheet = getOrCreateSheet("sites",
    ["id","name","latitude","longitude","radius","transportPrice"]
  );

  var sites = sitesSheet.getDataRange().getValues();
  sites.shift();

  // 1. Check Permanent Sites
  for (var i = 0; i < sites.length; i++) {
    var dist = getDistance(
      parseFloat(data.latitude),
      parseFloat(data.longitude),
      parseFloat(sites[i][2]),
      parseFloat(sites[i][3])
    );
    if (dist <= parseFloat(sites[i][4])) {
      return { id: sites[i][0], name: sites[i][1], transportPrice: sites[i][5] || 0 };
    }
  }

  // 2. Check Temporary Approvals (Approved Today)
  var reqSheet = getOrCreateSheet("siteRequests", ["id", "employeeId", "employeeName", "latitude", "longitude", "suggestedName", "mapLink", "status", "timestamp", "transportPrice"]);
  var reqRows = reqSheet.getDataRange().getValues();
  var today = new Date().toDateString();

  for (var j = reqRows.length - 1; j >= 1; j--) {
    if (reqRows[j][1] == data.employeeId && reqRows[j][7] === "approved_today") {
      var reqDate = new Date(reqRows[j][8]).toDateString();
      if (reqDate === today) {
        var dist = getDistance(
          parseFloat(data.latitude),
          parseFloat(data.longitude),
          parseFloat(reqRows[j][3]),
          parseFloat(reqRows[j][4])
        );
        if (dist <= 100) { // Default 100m for temp requests
          return { id: reqRows[j][0], name: reqRows[j][5], transportPrice: reqRows[j][9] || 0 };
        }
      }
    }
  }

  throw new Error("أنت خارج نطاق جميع مواقع العمل المسجلة.");
}

/////////////////////////////
// 🔥 GET API
/////////////////////////////
function doGet(e) {
  var action = e.parameter.action;

  try {

    if (action === "getEmployees") {
      var s = getOrCreateSheet("employees",
        ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]
      );

      var d = s.getDataRange().getValues();
      d.shift();

      return json({
        success:true,
        data:d.map(function(r) { return {
          id:r[0], name:r[1], email:r[2], phone:r[4], role:r[5], assignedSites:r[6]?r[6].toString().split(','):[], faceDescriptor:r[7], transportPrice:r[8]||0
        };})
      });
    }

    if (action === "getSites") {
      var s = getOrCreateSheet("sites",
        ["id","name","latitude","longitude","radius","transportPrice"]
      );

      var d = s.getDataRange().getValues();
      d.shift();

      return json({
        success:true,
        data:d.map(function(r) { return {
          id:String(r[0]), name:r[1], latitude:parseFloat(r[2]), longitude:parseFloat(r[3]), radius:parseFloat(r[4]), transportPrice:r[5]||0
        };})
      });
    }

    if (action === "getAttendance") {
      var s = getOrCreateSheet("attendance",
        ["employeeId","employeeName","siteId","siteName",
         "checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]
      );

      var d = s.getDataRange().getValues();
      d.shift();

      var records = d.map(function(r) { return {
          employeeId:r[0], employeeName:r[1], siteId:r[2], siteName:r[3],
          checkIn:r[4], checkOut:r[5], latitude:r[6], longitude:r[7], status:r[8], totalHours:r[9], transportPrice:r[10]||0
      };});
      
      if(e.parameter.employeeId) {
          records = records.filter(function(r) { return String(r.employeeId) === String(e.parameter.employeeId); });
      }

      return json({ success:true, data:records });
    }

    if (action === "getSettings") {
      var s = getOrCreateSheet("settings", ["key", "value"]);
      var rows = s.getDataRange().getValues();
      var settings = {};
      for (var i = 1; i < rows.length; i++) {
        settings[rows[i][0]] = s.getRange(i + 1, 2).getDisplayValue();
      }
      // Default values if not set
      if (!settings.workStartTime) settings.workStartTime = "09:00";
      if (!settings.workEndTime) settings.workEndTime = "17:00";
      
      return json({ success: true, data: settings });
    }

    if (action === "getSiteRequests") {
      var s = getOrCreateSheet("siteRequests", ["id", "employeeId", "employeeName", "latitude", "longitude", "suggestedName", "mapLink", "status", "timestamp", "transportPrice"]);
      var d = s.getDataRange().getValues();
      d.shift();
      return json({
        success: true,
        data: d.map(function(r) { return {
          id: r[0], employeeId: r[1], employeeName: r[2], latitude: r[3], longitude: r[4], suggestedName: r[5], mapLink: r[6], status: r[7], timestamp: r[8], transportPrice: r[9]||0
        };})
      });
    }

    return json({success:false,message:"Unknown action"});

  } catch(e){
    return json({success:false,message:e.toString()});
  }
}

/////////////////////////////
// 🔥 POST API
/////////////////////////////
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = getSpreadsheet();
    var action = data.action;

    // 1. CREATE TRIGGERS (Auto Reporting Schedule)
    if (action === "createTriggers") {
      try {
        createTriggers();
        return json({success:true});
      } catch(e) {
        return json({success:false, message: "خطأ في الجدولة: " + e.toString()});
      }
    }

    // 2. SEND MANUAL REPORT (Manual Trigger)
    if (action === "sendManualReport") {
      try {
        return sendManualReport(getSpreadsheet(), data);
      } catch(e) {
        return json({success:false, message: "خطأ في إرسال التقرير: " + e.toString()});
      }
    }
    
    // LOGIN
    if (action === "login") {
      var s = getOrCreateSheet("employees",
        ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]
      );

      var rows = s.getDataRange().getValues();
      rows.shift();

      var user = rows.find(function(r) { return r[2] === data.email && String(r[3]) === String(data.password); });

      if (!user) throw new Error("بيانات الدخول غير صحيحة أو لا تملك الصلاحية");
      if (data.role && user[5] !== data.role) throw new Error("بيانات الدخول غير صحيحة أو لا تملك الصلاحية");

      return json({
        success:true,
        data:{ id:user[0], name:user[1], email:user[2], phone:user[4], role:user[5], assignedSites:user[6]?user[6].toString().split(','):[], faceDescriptor:user[7]||"", transportPrice:user[8]||0 },
        message: "تم تسجيل الدخول بنجاح"
      });
    }

    // SEND OTP
    if (action === "sendOTP") {
       var sheet = getOrCreateSheet("employees", ["id","name","email","password","phone","role","assignedSites","faceDescriptor"]);
       var rows = sheet.getDataRange().getValues();
       rows.shift();
       var exists = rows.find(function(r) { return r[2] == data.email; });
       if(exists) {
           throw new Error("هذا البريد الإلكتروني مسجل مسبقاً، يمكنك تسجيل الدخول مباشرة.");
       }
       var code = Math.floor(1000 + Math.random() * 9000).toString();
       CacheService.getScriptCache().put(data.email, code, 600); // 10 minutes cache
       
       // Use GmailApp instead of MailApp for better Outlook deliverability
       // Also adding a sender name
       GmailApp.sendEmail(data.email, "رمز التحقق لتسجيل المستخد الجديد", 
         "مرحبا،\n\nرمز التحقق الخاص بك هو: " + code + "\nالرمز صالح لمدة 10 دقائق.",
         { name: "نظام إدارة الموارد البشرية (HR System)" }
       );
       return json({ success: true, message: "تم إرسال رمز التحقق" });
    }
    
    // VERIFY OTP
    if (data.action === "verifyOTP") {
       var cachedCode = CacheService.getScriptCache().get(data.email);
       if (cachedCode === data.code) {
           CacheService.getScriptCache().remove(data.email);
           return json({ success: true, message: "رمز صحيح" });
       } else {
           throw new Error("رمز التحقق غير صحيح أو منتهي الصلاحية");
       }
    }
    // Resolve Short Google Maps Links (Smart Extraction)
    else if (data.action === "resolveMapLink") {
        try {
            // 1. Follow redirects manually up to 3 times to get the deep URL
            var url = data.link;
            for(var i=0; i<3; i++) {
               var res = UrlFetchApp.fetch(url, { followRedirects: false, muteHttpExceptions: true });
               var loc = res.getHeaders()['Location'] || res.getHeaders()['location'];
               if(loc) { url = loc; } else { break; }
            }

            var lat = null, lng = null;
            // 2. Try to extract from URL (@lat,lng or center=lat,lng)
            var urlMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || 
                           url.match(/center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/) ||
                           url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/); // Common data pattern
            
            if (urlMatch) {
                lat = urlMatch[1]; lng = urlMatch[2];
            } else {
                // 3. Last resort: Fetch HTML and look for APP_INITIALIZATION_STATE
                var htmlRes = UrlFetchApp.fetch(url).getContentText();
                // Pattern for coordinates inside JSON-like structures in Maps source
                var htmlMatch = htmlRes.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/) ||
                                htmlRes.match(/\[\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
                if (htmlMatch) { lat = htmlMatch[1]; lng = htmlMatch[2]; }
            }
            
            // Validation: Google HQ in USA is ~37.4, -122. If we get something near that for Egypt URLs, it's a fallback error.
            if (lat && Math.abs(parseFloat(lat) - 37.42) < 0.1 && Math.abs(parseFloat(lng) + 122.08) < 0.1) {
                lat = null; lng = null; // Ignore Google HQ coordinate fallback
            }

            return json({ success: true, url: url, lat: lat, lng: lng });
        } catch(e) {
            return json({ success: false, message: e.toString() });
        }
    }

    // ADD EMPLOYEE
    if (data.action === "saveEmployee") {
      var s = getOrCreateSheet("employees",
        ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]
      );

      s.appendRow([
        data.id,data.name,data.email,data.password,
        data.phone,data.role,data.assignedSites,data.faceDescriptor,data.transportPrice || 0
      ]);

      return json({success:true, message: "تم حفظ بيانات الموظف بنجاح"});
    }

    // UPDATE EMPLOYEE
    if (data.action === "updateEmployee") {
      var s = getOrCreateSheet("employees", ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]);
      var rows = s.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.id)) {
          // Update (name to transportPrice)
          s.getRange(i + 1, 2, 1, 6).setValues([[data.name, data.email, data.password, data.phone, data.role, data.assignedSites]]);
          s.getRange(i+1, 9).setValue(data.transportPrice);
          return json({success:true, message: "تم تحديث بيانات الموظف بنجاح"});
        }
      }
      throw new Error("الموظف غير موجود");
    }

    // DELETE EMPLOYEE
    if (data.action === "deleteEmployee") {
      var s = getOrCreateSheet("employees", ["id","name","email","password","phone","role","assignedSites","faceDescriptor"]);
      var rows = s.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.id)) {
          s.deleteRow(i + 1);
          return json({success:true, message: "تم حذف الموظف بنجاح"});
        }
      }
      throw new Error("الموظف غير موجود");
    }

    // ADD SITE
    if (data.action === "saveSite") {
      var s = getOrCreateSheet("sites",
        ["id","name","latitude","longitude","radius","transportPrice"]
      );

      s.appendRow([
        data.id,data.name,
        data.latitude,data.longitude,data.radius,data.transportPrice || 0
      ]);

      return json({success:true, message: "تم إضافة الموقع بنجاح"});
    }

    // UPDATE SITE
    if (data.action === "updateSite") {
      var s = getOrCreateSheet("sites", ["id","name","latitude","longitude","radius","transportPrice"]);
      var rows = s.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.id)) {
          s.getRange(i + 1, 2, 1, 5).setValues([[data.name, data.latitude, data.longitude, data.radius, data.transportPrice]]);
          return json({success:true, message: "تم تحديث الموقع بنجاح"});
        }
      }
      throw new Error("الموقع غير موجود");
    }

    // DELETE SITE
    if (data.action === "deleteSite") {
      var s = getOrCreateSheet("sites", ["id","name","latitude","longitude","radius"]);
      var rows = s.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.id)) {
          s.deleteRow(i + 1);
          return json({success:true, message: "تم حذف الموقع بنجاح"});
        }
      }
      throw new Error("الموقع غير موجود");
    }

    // UPDATE SETTINGS
    if (data.action === "updateSettings") {
      var s = getOrCreateSheet("settings", ["key", "value"]);
      var rows = s.getDataRange().getValues();
      
      for (var key in data.settings) {
        var found = false;
        for (var i = 1; i < rows.length; i++) {
          if (rows[i][0] === key) {
            s.getRange(i + 1, 2).setValue(data.settings[key]);
            found = true;
            break;
          }
        }
        if (!found) {
          s.appendRow([key, data.settings[key]]);
        }
      }
      return json({ success: true, message: "تم تحديث الإعدادات بنجاح" });
    }

    // SITE REQUESTS
    if (data.action === "addSiteRequest") {
      var s = getOrCreateSheet("siteRequests", ["id", "employeeId", "employeeName", "latitude", "longitude", "suggestedName", "mapLink", "status", "timestamp", "transportPrice"]);
      s.appendRow([
        "REQ" + Math.floor(10000 + Math.random() * 90000),
        data.employeeId, data.employeeName, data.latitude, data.longitude, data.suggestedName, data.mapLink || "", "pending", new Date().toISOString(), 120 // Default 120
      ]);
      return json({ success: true, message: "تم إرسال طلب تسجيل الموقع بنجاح، بانتظار موافقة الإدارة." });
    }

    if (data.action === "approveSiteRequest") {
      var reqSheet = getOrCreateSheet("siteRequests", ["id", "employeeId", "employeeName", "latitude", "longitude", "suggestedName", "mapLink", "status", "timestamp", "transportPrice"]);
      var sitesSheet = getOrCreateSheet("sites", ["id", "name", "latitude", "longitude", "radius", "transportPrice"]);
      var rows = reqSheet.getDataRange().getValues();
      
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.id)) {
          
          if (data.mode === "always") {
            // Add to permanent sites
            sitesSheet.appendRow([
              Math.floor(10000 + Math.random() * 90000),
              data.name || rows[i][5],
              rows[i][3], rows[i][4], data.radius || 100, data.transportPrice || 120
            ]);
            reqSheet.getRange(i + 1, 8).setValue("approved");
          } else {
            // Approve for today only
            reqSheet.getRange(i + 1, 8).setValue("approved_today");
          }
          
          reqSheet.getRange(i + 1, 10).setValue(data.transportPrice || 120);
          return json({ success: true, message: "تمت الموافقة على الموقع بنجاح." });
        }
      }
      throw new Error("الطلب غير موجود");
    }

    if (data.action === "rejectSiteRequest") {
      var s = getOrCreateSheet("siteRequests", ["id", "employeeId", "employeeName", "latitude", "longitude", "suggestedName", "mapLink", "status", "timestamp", "transportPrice"]);
      var rows = s.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.id)) {
          s.getRange(i + 1, 8).setValue("rejected");
          return json({ success: true, message: "تم رفض الطلب." });
        }
      }
      throw new Error("الطلب غير موجود");
    }

    // CHECK-IN
    if (data.action === "addAttendance") {
      var site = validateAll(ss, data);

      var sheet = getOrCreateSheet("attendance",
        ["employeeId","employeeName","siteId","siteName",
         "checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]
      );

      var rows = sheet.getDataRange().getValues();
      var today = new Date().toDateString();
      for (var i = rows.length - 1; i >= 1; i--) {
        if (rows[i][0] == data.employeeId) {
          var rowDate = new Date(rows[i][4]).toDateString();
          if (rowDate === today && (rows[i][5] === "" || !rows[i][5])) {
            throw new Error("عفواً، لا يمكنك تسجيل الحضور مرتين. لديك عملية حضور مفتوحة اليوم، يرجى الانصراف أولاً.");
          }
        }
      }

      var checkInDate = new Date(data.checkIn);
      var dayOfWeek = checkInDate.getDay();
      var manualStatus = "present";

      // GET SETTINGS
      var settingsSheet = getOrCreateSheet("settings", ["key", "value"]);
      var sRows = settingsSheet.getDataRange().getValues();
      var workStart = "09:15"; // Default
      for(var j=1; j<sRows.length; j++) {
        if(sRows[j][0] === "workStartTime") {
          workStart = sRows[j][1];
          break;
        }
      }

      if (dayOfWeek === 5 || dayOfWeek === 6) {
        manualStatus = "overtime";
      } else {
        var parts = workStart.split(':');
        var lateLimit = new Date(checkInDate);
        lateLimit.setHours(parseInt(parts[0]), parseInt(parts[1] || 0), 0, 0);
        manualStatus = (checkInDate > lateLimit) ? "late" : "present";
      }

      sheet.appendRow([
        data.employeeId,data.employeeName,
        site.id,site.name,
        data.checkIn,"",
        data.latitude,data.longitude,
        manualStatus,"",
        site.transportPrice || 0
      ]);

      return json({success:true, message: "تم تسجيل الحضور بنجاح في: " + site.name + (site.transportPrice ? " (بدل انتقال: " + site.transportPrice + ")" : "")});
    }

// CHECK-OUT
    if (data.action === "checkoutAttendance") {
      validateAll(ss, data);

      var sheet = getOrCreateSheet("attendance",
        ["employeeId","employeeName","siteId","siteName",
         "checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]
      );

      var rows = sheet.getDataRange().getValues();

      for (var i=rows.length-1;i>=1;i--) {
        if (rows[i][0]==data.employeeId && (rows[i][5] === "" || !rows[i][5])) {
          var checkOutDate = new Date(data.checkOut);
          var checkInDate = new Date(rows[i][4]);
          var hours = ((checkOutDate - checkInDate) / 36e5).toFixed(2);

          sheet.getRange(i+1,6).setValue(data.checkOut);
          sheet.getRange(i+1,10).setValue(hours);

          return json({success:true, message: "تم تسجيل الانصراف وإجمالي الساعات: " + hours});
        }
      }

      throw new Error("لا يوجد عملية حضور مفتوحة لنسجل الانصراف");
    }

  } catch(e){
    return json({success:false,message:e.toString().replace('Error: ', '')});
  }
}

/////////////////////////////
// 🔥 AUTOMATED REPORTS
/////////////////////////////

function sendDailyReport() {
  var settings = getSettingsObject();
  if (settings.dailyReportEnabled !== "true") return;
  
  var emails = settings.reportEmails;
  if (!emails) return;

  var today = new Date();
  var start = new Date(today);
  start.setHours(0,0,0,0);
  var end = new Date(today);
  end.setHours(23,59,59,999);

  var records = getAttendanceInRange(start, end);
  if (records.length === 0) return;

  var htmlTable = generateHTMLTable(records, "تقرير الحضور اليومي - " + today.toLocaleDateString('ar-EG'));

  var title = "تقرير الحضور اليومي - " + today.toLocaleDateString('ar-EG');
  GmailApp.sendEmail(emails, title, 
    "مرفق تقرير الحضور اليومي بصيغة Excel الاحترافية.", {
    htmlBody: htmlTable,
    attachments: [generateStyledExcel(records, title)],
    name: "نظام الموارد البشرية"
  });
}

function sendManualReport(ss, data) {
  var settings = getSettingsObject();
  var emails = settings.reportEmails;
  if (!emails) throw new Error("يرجى إعداد إيميلات الاستلام في الإعدادات أولاً");

  var start = new Date(data.startDate);
  start.setHours(0,0,0,0);
  var end = new Date(data.endDate);
  end.setHours(23,59,59,999);

  var records = getAttendanceInRange(start, end);
  if (records.length === 0) return json({success:false, message: "لا توجد سجلات في هذه الفترة"});

  var title = "تقرير حضور مخصص: " + start.toLocaleDateString('ar-EG') + " إلى " + end.toLocaleDateString('ar-EG');
  var htmlTable = generateHTMLTable(records, title);

  GmailApp.sendEmail(emails, title, 
    "مرفق التقرير المخصص بصيغة Excel الاحترافية.", {
    htmlBody: htmlTable,
    attachments: [generateStyledExcel(records, title)],
    name: "نظام الموارد البشرية"
  });

  return json({success:true});
}

function sendMonthlyReport() {
  var settings = getSettingsObject();
  if (settings.monthlyReportEnabled !== "true") return;
  
  var emails = settings.reportEmails;
  if (!emails) return;

  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), 1);
  var end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  var records = getAttendanceInRange(start, end);
  if (records.length === 0) return;

  var title = "التقرير الشهري الشامل - " + (now.getMonth() + 1) + "/" + now.getFullYear();
  var htmlTable = generateHTMLTable(records, title);

  GmailApp.sendEmail(emails, title, 
    "مرفق التقرير الشهري الشامل بصيغة Excel الاحترافية.", {
    htmlBody: htmlTable,
    attachments: [generateStyledExcel(records, title)],
    name: "نظام الموارد البشرية"
  });
}

function getSettingsObject() {
  var s = getOrCreateSheet("settings", ["key", "value"]);
  var rows = s.getDataRange().getValues();
  var obj = {};
  for(var i=1; i<rows.length; i++) obj[rows[i][0]] = rows[i][1];
  return obj;
}

/////////////////////////////
// 🔥 PERMISSIONS INITIALIZER
// (Run this once manually if you get 'Permission denied')
/////////////////////////////
function initializePermissions() {
  // Touching these services forces GAS to ask for authorization
  DriveApp.getRootFolder();
  GmailApp.getAliases();
  SpreadsheetApp.getActive();
  console.log("✅ All permissions requested. Please follow the popup instructions.");
}

function getAttendanceInRange(start, end) {
  var s = getOrCreateSheet("attendance", ["employeeId","employeeName","siteId","siteName","checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]);
  var data = s.getDataRange().getValues();
  data.shift();
  
  return data.filter(function(r) {
    var d = new Date(r[4]);
    return d >= start && d <= end;
  }).map(function(r) {
    return {
      employeeId: r[0], employeeName: r[1], siteName: r[3], checkIn: r[4], checkOut: r[5], status: r[8], hours: r[9], transport: r[10]
    };
  });
}

function generateStyledExcel(records, reportTitle) {
  var ss;
  try {
    // 1. Create the temporary spreadsheet
    ss = SpreadsheetApp.create("temp_report_" + new Date().getTime());
    var sheet = ss.getSheets()[0];
    
    // Headers & Styling
    var headers = ["اسم الموظف (Name)", "الموقع (Site)", "تاريخ ووقت الحضور", "تاريخ ووقت الانصراف", "الحالة (Status)", "إجمالي الساعات", "بدل الانتقال (EGP)"];
    sheet.appendRow([reportTitle]);
    sheet.getRange("A1:G1").merge().setFontSize(14).setFontWeight("bold").setHorizontalAlignment("center").setBackground("#4f46e5").setFontColor("#ffffff");
    sheet.appendRow(headers);
    sheet.getRange("A2:G2").setBackground("#f1f5f9").setFontWeight("bold").setHorizontalAlignment("center").setBorder(true, true, true, true, true, true);
    
    var totalTransport = 0;
    records.forEach(function(r) {
      totalTransport += parseFloat(r.transport || 0);
      sheet.appendRow([
        r.employeeName,
        r.siteName,
        r.checkIn ? new Date(r.checkIn) : "-",
        r.checkOut ? new Date(r.checkOut) : "-",
        r.status || "present",
        r.hours || "0",
        r.transport || "0"
      ]);
    });
    
    var lastRow = sheet.getLastRow();
    if (lastRow > 2) {
      sheet.getRange(3, 1, lastRow - 2, 7).setBorder(true, true, true, true, true, true).setHorizontalAlignment("center");
      for (var i = 3; i <= lastRow; i++) if (i % 2 === 0) sheet.getRange(i, 1, 1, 7).setBackground("#f8fafc");
    }
    sheet.appendRow(["", "", "", "", "", "الإجمالي:", totalTransport + " ج.م"]);
    sheet.getRange(sheet.getLastRow(), 6, 1, 2).setFontWeight("bold").setBackground("#f0fdf4").setFontColor("#166534");
    sheet.setColumnWidths(1, 1, 150);
    sheet.setColumnWidths(2, 6, 120);
    sheet.setRightToLeft(true);
    SpreadsheetApp.flush();
    
    // 2. Try to get XLSX blob via DriveApp (Requires Permission)
    var blob;
    try {
      blob = DriveApp.getFileById(ss.getId()).getBlob().setName(reportTitle + ".xlsx");
      // Cleanup
      try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch(trashErr) {}
    } catch(driveError) {
      // If Drive fails, this will fall through to the catch block below
      throw driveError;
    }
    
    return blob;

  } catch(e) {
    // Final safety cleanup (wrap in try to avoid secondary crashes)
    if (ss) { try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch(t) {} }
    
    // 🚀 FALLBACK: Generate professional CSV if Excel/Drive fails
    var BOM = "\uFEFF"; 
    var csvHeaders = ["الاسم", "الموقع", "الحضور", "الانصراف", "الحالة", "الساعات", "البدل"];
    var csvLines = [csvHeaders.join(",")];
    records.forEach(function(r) {
      var row = [
        '"' + r.employeeName + '"',
        '"' + r.siteName + '"',
        '"' + (r.checkIn ? new Date(r.checkIn).toLocaleString('ar-EG') : "-") + '"',
        '"' + (r.checkOut ? new Date(r.checkOut).toLocaleString('ar-EG') : "-") + '"',
        '"' + (r.status || "حاضر") + '"',
        '"' + (r.hours || "0") + '"',
        '"' + (r.transport || "0") + '"'
      ];
      csvLines.push(row.join(","));
    });
    return Utilities.newBlob(BOM + csvLines.join("\n"), 'text/csv', reportTitle + ".csv");
  }
}

function generateHTMLTable(records, title) {
  var totalTransport = 0;
  var totalHours = 0;
  var uniqueEmployees = new Set();
  var totalLates = 0;

  var rows = records.map(function(r) {
    totalTransport += parseFloat(r.transport || 0);
    totalHours += parseFloat(r.hours || 0);
    uniqueEmployees.add(r.employeeId);
    if(r.status === 'late') totalLates++;

    var statusColor = "#10b981"; // success
    var statusText = "حاضر";
    if(r.status === 'late') { statusColor = "#ef4444"; statusText = "متأخر"; }
    else if(r.status === 'overtime') { statusColor = "#3b82f6"; statusText = "إضافي"; }

    return `
      <tr style="border-bottom: 1px solid #edf2f7;">
        <td style="padding: 12px 8px; color: #1a202c; font-weight: 500;">${r.employeeName}</td>
        <td style="padding: 12px 8px; color: #4a5568;">${r.siteName}</td>
        <td style="padding: 12px 8px; color: #4a5568; font-size: 0.85rem;" dir="ltr">${new Date(r.checkIn).toLocaleString('ar-EG', {hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit'})}</td>
        <td style="padding: 12px 8px;">
          <span style="background-color: ${statusColor}15; color: ${statusColor}; padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: bold;">${statusText}</span>
        </td>
        <td style="padding: 12px 8px; color: #2d3748; font-weight: bold;">${parseFloat(r.transport || 0).toFixed(2)} ج.م</td>
      </tr>
    `;
  }).join("");

  return `
    <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 700px; margin: 20px auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #2d3748;">
      
      <!-- Header -->
      <div style="text-align: center; margin-bottom: 30px; border-bottom: 2px solid #4f46e5; padding-bottom: 15px;">
        <h1 style="color: #4f46e5; margin: 0; font-size: 1.6rem;">${title}</h1>
        <p style="color: #718096; margin-top: 5px; font-size: 0.9rem;">نظام إدارة الموارد البشرية الذكي</p>
      </div>

      <!-- Summary Cards -->
      <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 30px; text-align: center;">
        <div style="flex: 1; min-width: 140px; background: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0;">
          <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 5px;">الموظفين</div>
          <div style="font-size: 1.25rem; font-weight: bold; color: #4f46e5;">${uniqueEmployees.size}</div>
        </div>
        <div style="flex: 1; min-width: 140px; background: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0;">
          <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 5px;">إجمالي الساعات</div>
          <div style="font-size: 1.25rem; font-weight: bold; color: #4f46e5;">${totalHours.toFixed(1)}</div>
        </div>
        <div style="flex: 1; min-width: 140px; background: #fdf2f2; padding: 15px; border-radius: 12px; border: 1px solid #fee2e2;">
          <div style="font-size: 0.75rem; color: #991b1b; margin-bottom: 5px;">التأخيرات</div>
          <div style="font-size: 1.25rem; font-weight: bold; color: #dc2626;">${totalLates}</div>
        </div>
        <div style="flex: 1; min-width: 140px; background: #f0fdf4; padding: 15px; border-radius: 12px; border: 1px solid #dcfce7;">
          <div style="font-size: 0.75rem; color: #166534; margin-bottom: 5px;">إجمالي البدلات</div>
          <div style="font-size: 1.25rem; font-weight: bold; color: #16a34a;">${totalTransport.toFixed(0)} <span style="font-size: 0.7rem;">ج.م</span></div>
        </div>
      </div>

      <!-- Table -->
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f1f5f9; text-align: right;">
              <th style="padding: 12px 8px; color: #475569; font-size: 0.85rem;">الموظف</th>
              <th style="padding: 12px 8px; color: #475569; font-size: 0.85rem;">الموقع</th>
              <th style="padding: 12px 8px; color: #475569; font-size: 0.85rem;">الوقت</th>
              <th style="padding: 12px 8px; color: #475569; font-size: 0.85rem;">الحالة</th>
              <th style="padding: 12px 8px; color: #475569; font-size: 0.85rem;">البدل</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>

      <!-- Footer -->
      <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 0.75rem; color: #94a3b8; text-align: center;">
        تم توليد هذا التقرير آلياً بواسطة نظام HR المطور. المرفق يحتوي على كافة التفاصيل بصيغة Excel.
      </div>
    </div>
  `;
}

function createTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  
  // Daily at 11 PM
  ScriptApp.newTrigger("sendDailyReport")
    .timeBased()
    .atHour(23)
    .everyDays(1)
    .create();
    
  // Monthly on the 1st
  ScriptApp.newTrigger("sendMonthlyReport")
    .timeBased()
    .onMonthDay(1)
    .atHour(1)
    .create();
}

/////////////////////////////
// 🔥 JSON RESPONSE
/////////////////////////////
function json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}