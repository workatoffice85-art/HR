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
    ["id","name","latitude","longitude","radius"]
  );

  var sites = sitesSheet.getDataRange().getValues();
  sites.shift();

  if (sites.length === 0) throw new Error("لا توجد مواقع عمل مسجلة بعد.");

  // Check ALL sites - employee is registered at whichever site he is at
  for (var i = 0; i < sites.length; i++) {
    var dist = getDistance(
      parseFloat(data.latitude),
      parseFloat(data.longitude),
      parseFloat(sites[i][2]),
      parseFloat(sites[i][3])
    );
    if (dist <= parseFloat(sites[i][4])) {
      return { id: sites[i][0], name: sites[i][1] };
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
        ["id","name","email","password","phone","role","assignedSites","faceDescriptor"]
      );

      var d = s.getDataRange().getValues();
      d.shift();

      return json({
        success:true,
        data:d.map(function(r) { return {
          id:r[0], name:r[1], email:r[2], phone:r[4], role:r[5], assignedSites:r[6]?r[6].toString().split(','):[], faceDescriptor:r[7]
        };})
      });
    }

    if (action === "getSites") {
      var s = getOrCreateSheet("sites",
        ["id","name","latitude","longitude","radius"]
      );

      var d = s.getDataRange().getValues();
      d.shift();

      return json({
        success:true,
        data:d.map(function(r) { return {
          id:String(r[0]), name:r[1], latitude:parseFloat(r[2]), longitude:parseFloat(r[3]), radius:parseFloat(r[4])
        };})
      });
    }

    if (action === "getAttendance") {
      var s = getOrCreateSheet("attendance",
        ["employeeId","employeeName","siteId","siteName",
         "checkIn","checkOut","latitude","longitude","status","totalHours"]
      );

      var d = s.getDataRange().getValues();
      d.shift();

      var records = d.map(function(r) { return {
          employeeId:r[0], employeeName:r[1], siteId:r[2], siteName:r[3],
          checkIn:r[4], checkOut:r[5], latitude:r[6], longitude:r[7], status:r[8], totalHours:r[9]
      };});
      
      if(e.parameter.employeeId) {
          records = records.filter(function(r) { return String(r.employeeId) === String(e.parameter.employeeId); });
      }

      return json({ success:true, data:records });
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

    // LOGIN
    if (data.action === "login") {
      var s = getOrCreateSheet("employees",
        ["id","name","email","password","phone","role","assignedSites","faceDescriptor"]
      );

      var rows = s.getDataRange().getValues();
      rows.shift();

      var user = rows.find(function(r) { return r[2] === data.email && String(r[3]) === String(data.password); });

      if (!user) throw new Error("بيانات الدخول غير صحيحة أو لا تملك الصلاحية");
      if (data.role && user[5] !== data.role) throw new Error("بيانات الدخول غير صحيحة أو لا تملك الصلاحية");

      return json({
        success:true,
        data:{ id:user[0], name:user[1], email:user[2], phone:user[4], role:user[5], assignedSites:user[6]?user[6].toString().split(','):[], faceDescriptor:user[7]||"" },
        message: "تم تسجيل الدخول بنجاح"
      });
    }
    
    // SEND OTP
    if (data.action === "sendOTP") {
       var sheet = getOrCreateSheet("employees", ["id","name","email","password","phone","role","assignedSites","faceDescriptor"]);
       var rows = sheet.getDataRange().getValues();
       rows.shift();
       var exists = rows.find(function(r) { return r[2] == data.email; });
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

    // RESOLVE MAP LINK
    if (data.action === "resolveMapLink") {
        try {
            var options = { followRedirects: false, muteHttpExceptions: true };
            var fetchRes = UrlFetchApp.fetch(data.link, options);
            var finalUrl = fetchRes.getHeaders()['Location'] || fetchRes.getHeaders()['location'] || data.link;
            
            var lat = null, lng = null;
            var match1 = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (match1) { lat = match1[1]; lng = match1[2]; }
            else {
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
            return json({ success: true, url: finalUrl, lat: lat, lng: lng });
        } catch(e) {
            return json({ success: false, message: e.toString() });
        }
    }

    // ADD EMPLOYEE
    if (data.action === "saveEmployee") {
      var s = getOrCreateSheet("employees",
        ["id","name","email","password","phone","role","assignedSites","faceDescriptor"]
      );

      s.appendRow([
        data.id,data.name,data.email,data.password,
        data.phone,data.role,data.assignedSites,data.faceDescriptor
      ]);

      return json({success:true, message: "تم حفظ بيانات الموظف بنجاح"});
    }

    // ADD SITE
    if (data.action === "saveSite") {
      var s = getOrCreateSheet("sites",
        ["id","name","latitude","longitude","radius"]
      );

      s.appendRow([
        data.id,data.name,
        data.latitude,data.longitude,data.radius
      ]);

      return json({success:true, message: "تم إضافة الموقع بنجاح"});
    }

    // CHECK-IN
    if (data.action === "addAttendance") {
      var site = validateAll(ss, data);

      var sheet = getOrCreateSheet("attendance",
        ["employeeId","employeeName","siteId","siteName",
         "checkIn","checkOut","latitude","longitude","status","totalHours"]
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
      var lateLimit = new Date(checkInDate);
      lateLimit.setHours(9, 15, 0, 0); // 09:15 AM
      var manualStatus = (checkInDate > lateLimit) ? "late" : "present";

      sheet.appendRow([
        data.employeeId,data.employeeName,
        site.id,site.name,
        data.checkIn,"",
        data.latitude,data.longitude,
        manualStatus,""
      ]);

      return json({success:true, message: "تم تسجيل الحضور بنجاح في: " + site.name});
    }

    // CHECK-OUT
    if (data.action === "checkoutAttendance") {
      validateAll(ss, data);

      var sheet = getOrCreateSheet("attendance",
        ["employeeId","employeeName","siteId","siteName",
         "checkIn","checkOut","latitude","longitude","status","totalHours"]
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
// 🔥 JSON RESPONSE
/////////////////////////////
function json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}