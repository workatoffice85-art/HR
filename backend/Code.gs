function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doGet(e) {
  var action = e.parameter.action;
  var response = { success: false, data: null, message: "" };
  
  try {
    var ss = getSpreadsheet();
    if (!ss) throw new Error("Could not access spreadsheet.");

    if (action === "getEmployees") {
      var sheet = ss.getSheetByName("employees");
      var data = sheet.getDataRange().getValues();
      var headers = data.shift(); // id, name, email, password, phone, role, assignedSites, faceDescriptor
      var employees = data.map(function(row) {
         return {
            id: row[0], name: row[1], email: row[2], phone: row[4], role: row[5],
            assignedSites: row[6] ? row[6].toString().split(',') : [],
            faceDescriptor: row[7] || ""
         };
      });
      response = { success: true, data: employees };
    }
    else if (action === "getSites") {
      var sheet = ss.getSheetByName("sites");
      var data = sheet.getDataRange().getValues();
      data.shift();
      var sites = data.map(function(row) {
         return {
            id: String(row[0]), name: row[1], latitude: parseFloat(row[2]), longitude: parseFloat(row[3]), radius: parseFloat(row[4])
         };
      });
      response = { success: true, data: sites };
    }
    else if (action === "getAttendance") {
      var sheet = ss.getSheetByName("attendance");
      var data = sheet.getDataRange().getValues();
      data.shift();
      var records = data.map(function(row) {
         return {
            employeeId: row[0], employeeName: row[1], siteId: row[2], siteName: row[3],
            checkIn: row[4], checkOut: row[5], latitude: row[6], longitude: row[7],
            status: row[8], totalHours: row[9]
         };
      });
      if(e.parameter.employeeId) {
          records = records.filter(function(r) { return String(r.employeeId) === String(e.parameter.employeeId); });
      }
      response = { success: true, data: records };
    } else {
        response.message = "Unknown action.";
    }
  } catch(error) {
     response = { success: false, message: error.toString() };
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
}

// Helper: Haversine distance
function getDistance(lat1, lon1, lat2, lon2) {
    var R = 6371e3; // metres
    var f1 = lat1 * Math.PI/180;
    var f2 = lat2 * Math.PI/180;
    var df = (lat2-lat1) * Math.PI/180;
    var dl = (lon2-lon1) * Math.PI/180;
    var a = Math.sin(df/2) * Math.sin(df/2) +
            Math.cos(f1) * Math.cos(f2) *
            Math.sin(dl/2) * Math.sin(dl/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Helper: Euclidean distance for 128d face array
function getFaceDistance(arr1, arr2) {
    if(!arr1 || !arr2 || arr1.length !== 128 || arr2.length !== 128) return 1.0;
    var sum = 0;
    for (var k = 0; k < 128; k++) {
        sum += Math.pow(arr1[k] - arr2[k], 2);
    }
    return Math.sqrt(sum);
}

// Helper: Validate Server Side
function checkServerValidations(ss, data) {
    var empSheet = ss.getSheetByName("employees");
    var empRows = empSheet.getDataRange().getValues();
    empRows.shift();
    var empConfig = empRows.find(function(r) { return r[0] == data.employeeId; });
    if(!empConfig) throw new Error("الموظف غير موجود");
    
    var assignedSitesStr = empConfig[6] ? empConfig[6].toString().trim() : "";
    var assignedSites = assignedSitesStr ? assignedSitesStr.split(',') : [];
    var storedDescriptorStr = empConfig[7];
    
    // 1. Face Verification Server-Side
    if (storedDescriptorStr && data.faceDescriptor) {
        try {
            var storedArr = JSON.parse(storedDescriptorStr);
            var currentArr = JSON.parse(data.faceDescriptor);
            var fDist = getFaceDistance(storedArr, currentArr);
            if (fDist > 0.6) {
                throw new Error("بصمة الوجه غير متطابقة (Distance: " + fDist.toFixed(2) + "). العملية مرفوضة.");
            }
        } catch(e) {
            if(e.message && e.message.indexOf("بصمة") !== -1) throw e;
            throw new Error("خطأ في تحليل بصمة الوجه");
        }
    } else if (storedDescriptorStr && !data.faceDescriptor) {
        throw new Error("مطلوب توثيق بصمة الوجه للعملية");
    }

    // 2. GPS Verification Server-Side
    if(!data.latitude || !data.longitude) throw new Error("يجب توفير إحداثيات الموقع (GPS)");
    
    var siteSheet = ss.getSheetByName("sites");
    var siteRows = siteSheet.getDataRange().getValues();
    siteRows.shift(); // id, name, lat, lng, radius
    
    var isValidGPS = false;
    var matchedSite = null;
    var reqLat = parseFloat(data.latitude);
    var reqLng = parseFloat(data.longitude);
    
    if (assignedSites.length > 0) {
        for (var i = 0; i < siteRows.length; i++) {
            var sId = String(siteRows[i][0]);
            if (assignedSites.indexOf(sId) !== -1) {
                var dist = getDistance(reqLat, reqLng, parseFloat(siteRows[i][2]), parseFloat(siteRows[i][3]));
                if (dist <= parseFloat(siteRows[i][4])) {
                    isValidGPS = true;
                    matchedSite = { id: sId, name: siteRows[i][1] };
                    break;
                }
            }
        }
        if (!isValidGPS) {
            throw new Error("أنت خارج نطاق المواقع المخصصة لك، أو الإحداثيات غير صحيحة.");
        }
    } else {
        throw new Error("الموظف غير معين في أي موقع عمل.");
    }
    return matchedSite;
}

function doPost(e) {
  var response = { success: false, message: "" };
  
  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var ss = getSpreadsheet();
    
    // 0. Login Block
    if (data.action === "login") {
        var sheet = ss.getSheetByName("employees");
        var rows = sheet.getDataRange().getValues();
        rows.shift(); // remove headers
        
        var user = null;
        for (var i = 0; i < rows.length; i++) {
           if (rows[i][2] === data.email && String(rows[i][3]) === String(data.password)) {
               if (data.role && rows[i][5] !== data.role) {
                   continue; // skip if roles don't match (e.g. asking for HR but user is employee)
               }
               user = {
                   id: rows[i][0], name: rows[i][1], email: rows[i][2], phone: rows[i][4], role: rows[i][5],
                   assignedSites: rows[i][6] ? rows[i][6].toString().split(',') : [],
                   faceDescriptor: rows[i][7] || ""
               };
               break;
           }
        }
        if (user) {
            response = { success: true, data: user, message: "تم تسجيل الدخول بنجاح" };
        } else {
            throw new Error("بيانات الدخول غير صحيحة أو لا تملك الصلاحية");
        }
    }
    // 1. Send OTP
    if (data.action === "sendOTP") {
       var sheet = ss.getSheetByName("employees");
       var rows = sheet.getDataRange().getValues();
       rows.shift();
       var exists = rows.find(r => r[2] == data.email);
       if(exists) {
           throw new Error("هذا البريد الإلكتروني مسجل مسبقاً، يمكنك تسجيل الدخول مباشرة.");
       }
       var code = Math.floor(1000 + Math.random() * 9000).toString();
       CacheService.getScriptCache().put(data.email, code, 600); // 10 minutes cache
       
       MailApp.sendEmail({
        to: data.email,
        subject: "رمز التحقق لتسجيل المستخد الجديد",
        body: "مرحبا،\n\nرمز التحقق الخاص بك هو: " + code + "\nالرمز صالح لمدة 10 دقائق."
       });
       response = { success: true, message: "تم إرسال رمز التحقق" };
    }
    // 2. Verify OTP
    else if (data.action === "verifyOTP") {
       var cachedCode = CacheService.getScriptCache().get(data.email);
       if (cachedCode === data.code) {
           response = { success: true, message: "رمز صحيح" };
           CacheService.getScriptCache().remove(data.email);
       } else {
           throw new Error("رمز التحقق غير صحيح أو منتهي الصلاحية");
       }
    }
    // Resolve Short Google Maps Links (Server-Side to bypass CORS & Obfuscation)
    else if (data.action === "resolveMapLink") {
        try {
            var options = { followRedirects: false, muteHttpExceptions: true };
            var fetchRes = UrlFetchApp.fetch(data.link, options);
            var finalUrl = fetchRes.getHeaders()['Location'] || fetchRes.getHeaders()['location'] || data.link;
            
            var lat = null, lng = null;
            // 1. Check if the redirected URL already contains it
            var match1 = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (match1) { lat = match1[1]; lng = match1[2]; }
            else {
                // 2. Fetch the HTML page and look for embedded coordinates
                var htmlRes = UrlFetchApp.fetch(finalUrl).getContentText();
                var match2 = htmlRes.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/) || htmlRes.match(/center=(-?\d+\.\d+),(-?\d+\.\d+)/);
                if (match2) { lat = match2[1]; lng = match2[2]; }
                else {
                    var match3 = htmlRes.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
                    if (match3) { lat = match3[1]; lng = match3[2]; }
                    else {
                        var match4 = htmlRes.match(/@(-?\d+\.\d+),(-?\d+\.\d+),/);
                        if (match4) { lat = match4[1]; lng = match4[2]; }
                    }
                }
            }
            response = { success: true, url: finalUrl, lat: lat, lng: lng };
        } catch(e) {
            response = { success: false, message: e.toString() };
        }
    }
    else if (data.action === "saveSite") {
        var sheet = ss.getSheetByName("sites");
        // id, name, lat, lng, radius
        sheet.appendRow([
            data.id, data.name, data.latitude, data.longitude, data.radius
        ]);
        response = { success: true, message: "تم إضافة الموقع بنجاح" };
    }
    // 3. Save New Employee
    else if (data.action === "saveEmployee") {
        var sheet = ss.getSheetByName("employees");
        // id, name, email, password, phone, role, assignedSites, faceDescriptor
        sheet.appendRow([
            data.id, data.name, data.email, data.password, data.phone, data.role, data.assignedSites, data.faceDescriptor
        ]);
        response = { success: true, message: "تم حفظ بيانات الموظف بنجاح" };
    }
    // 4. Add Attendance (Prevent Duplicate Check-in)
    else if (data.action === "addAttendance") {
      var matchedSite = checkServerValidations(ss, data);
      
      var sheet = ss.getSheetByName("attendance");
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
      
      var manualStatus = data.status || "present";
      // Calculate 'Late' if CheckIn is after 09:15 AM
      var checkInDate = new Date(data.checkIn);
      var lateLimit = new Date(checkInDate);
      lateLimit.setHours(9, 15, 0, 0); // 09:15 AM
      if (checkInDate > lateLimit) {
          manualStatus = "late";
      }

      sheet.appendRow([
        data.employeeId, data.employeeName, matchedSite.id, matchedSite.name,
        data.checkIn, "", data.latitude, data.longitude,
        manualStatus, ""
      ]);
      response = { success: true, message: "تم تسجيل الحضور بنجاح في: " + matchedSite.name };
    }
    // 5. Check out Attendance & Compute Hours
    else if (data.action === "checkoutAttendance") {
      // Validate GPS & Face
      checkServerValidations(ss, data);

      var sheet = ss.getSheetByName("attendance");
      var rows = sheet.getDataRange().getValues();
      var updated = false;
      var today = new Date().toDateString();
      
      for (var i = rows.length - 1; i >= 1; i--) {
        // Find active checkin for this employee today
        if (rows[i][0] == data.employeeId && (rows[i][5] === "" || !rows[i][5])) {
          var checkOutDate = new Date(data.checkOut);
          var checkInDate = new Date(rows[i][4]);
          
          if(checkInDate.toDateString() !== today) {
              // overnight support check removed for simplicity
          }
          
          // Automatic hours calculation
          var diffMs = checkOutDate - checkInDate;
          var hours = (diffMs / 36e5).toFixed(2); // hours decimal
          
          sheet.getRange(i + 1, 6).setValue(data.checkOut);
          sheet.getRange(i + 1, 10).setValue(hours);
          // Optional: Record checkout GPS location too (in a new col if we want, ignoring for now)
          
          updated = true;
          response = { success: true, message: "تم تسجيل الانصراف وإجمالي الساعات: " + hours };
          break;
        }
      }
      if(!updated) {
          throw new Error("لا يوجد عملية حضور مفتوحة لنسجل الانصراف");
      }
    }
  } catch(error) {
    response = { success: false, message: error.toString().replace('Error: ', '') };
  }
  
  return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
}
