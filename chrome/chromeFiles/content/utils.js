const GM_GUID = "{e4a8a97b-f2ed-450b-b12d-ee082ba24781}";

// TODO: properly scope this constant
const NAMESPACE = "http://youngpup.net/greasemonkey";

var GM_consoleService = Components.classes["@mozilla.org/consoleservice;1"]
                        .getService(Components.interfaces.nsIConsoleService);

function GM_apiLeakCheck() {
  var stack = Components.stack;

  do {
    if (2 == stack.language) {
      if ('file' != stack.filename.substr(0, 4) &&
          'chrome' != stack.filename.substr(0, 6)) {
        throw new Error("Greasemonkey access violation");
      }
    }

    stack = stack.caller;
  } while (stack);
};

function GM_isDef(thing) {
  return typeof(thing) != "undefined";
};

function GM_hitch(obj, meth) {
  if (typeof meth != "function") {
    if (!obj[meth]) {
      throw "method '" + meth + "' does not exist on object '" + obj + "'";
    }
    meth = obj[meth];
  }

  var staticArgs = Array.prototype.splice.call(arguments, 2, arguments.length);

  return function() {
    // make a copy of staticArgs (don't modify it because it gets reused for
    // every invocation).
    var args = staticArgs.concat();

    // add all the new arguments
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }

    // invoke the original function with the correct this obj and the combined
    // list of static and dynamic arguments.
    return meth.apply(obj, args);
  };
};

function GM_listen(source, event, listener, opt_capture) {
  Components.lookupMethod(source, "addEventListener")(
    event, listener, opt_capture);
};

function GM_unlisten(source, event, listener, opt_capture) {
  Components.lookupMethod(source, "removeEventListener")(
    event, listener, opt_capture);
};

/**
 * Utility to create an error message in the log without throwing an error.
 */
function GM_logError(e, opt_warn, fileName, lineNumber) {
  var consoleService = Components.classes['@mozilla.org/consoleservice;1']
    .getService(Components.interfaces.nsIConsoleService);

  var consoleError = Components.classes['@mozilla.org/scripterror;1']
    .createInstance(Components.interfaces.nsIScriptError);

  var flags = opt_warn ? 1 : 0;

  // third parameter "sourceLine" is supposed to be the line, of the source,
  // on which the error happened.  we don't know it. (directly...)
  consoleError.init(e.message, fileName, null, lineNumber,
                    e.columnNumber, flags, null);

  consoleService.logMessage(consoleError);
};

function GM_log(message, force) {
  if (force || GM_prefRoot.getValue("logChrome", false)) {
    GM_consoleService.logStringMessage(message);
  }
};

// TODO: this stuff was copied wholesale and not refactored at all. Lots of
// the UI and Config rely on it. Needs rethinking.

function openInEditor(aFile, promptTitle) {
  var editor = getEditor(promptTitle);
  if (!editor) {
    // The user did not choose an editor.
    return;
  }

  try {
    launchApplicationWithDoc(editor, aFile);
  } catch (e) {
    // Something may be wrong with the editor the user selected. Remove so that
    // next time they can pick a different one.
    alert("Could not launch editor:\n" + e);
    GM_prefRoot.remove("editor");
    throw e;
  }
}

function getEditor(promptTitle) {
  var editorPath = GM_prefRoot.getValue("editor");

  if (editorPath) {
    GM_log("Found saved editor preference: " + editorPath);

    var editor = Components.classes["@mozilla.org/file/local;1"]
                 .createInstance(Components.interfaces.nsILocalFile);
    editor.followLinks = true;
    editor.initWithPath(editorPath);

    // make sure the editor preference is still valid
    if (editor.exists() && editor.isExecutable()) {
      return editor;
    } else {
      GM_log("Editor preference either does not exist or is not executable");
      GM_prefRoot.remove("editor");
    }
  }

  // Ask the user to choose a new editor. Sometimes users get confused and
  // pick a non-executable file, so we set this up in a loop so that if they do
  // that we can give them an error and try again.
  while (true) {
    GM_log("Asking user to choose editor...");
    var nsIFilePicker = Components.interfaces.nsIFilePicker;
    var filePicker = Components.classes["@mozilla.org/filepicker;1"]
                               .createInstance(nsIFilePicker);

    filePicker.init(window, promptTitle, nsIFilePicker.modeOpen);
    filePicker.appendFilters(nsIFilePicker.filterApplication);
    filePicker.appendFilters(nsIFilePicker.filterAll);

    if (filePicker.show() != nsIFilePicker.returnOK) {
      // The user canceled, return null.
      GM_log("User canceled file picker dialog");
      return null;
    }

    GM_log("User selected: " + filePicker.file.path);

    if (filePicker.file.exists() && filePicker.file.isExecutable()) {
      GM_prefRoot.setValue("editor", filePicker.file.path);
      return filePicker.file;
    } else {
      // TODO: i18n
      alert("Please pick an executable application to use to edit user " +
            "scripts.");
    }
  }
}

function launchApplicationWithDoc(appFile, docFile) {
  var xulRuntime = Components.classes["@mozilla.org/xre/app-info;1"]
                             .getService(Components.interfaces.nsIXULRuntime);
  // See Mozilla bug: https://bugzilla.mozilla.org/show_bug.cgi?id=411819
  // TODO: remove this when nsIMIMEInfo works on windows again.
  if (xulRuntime.OS.toLowerCase().substring(0, 3) == "win") {
    var process = Components.classes["@mozilla.org/process/util;1"]
                            .createInstance(Components.interfaces.nsIProcess);
    process.init(appFile);
    process.run(false, // blocking
                [docFile.path], // args
                1); // number of args
  } else {
    var mimeInfoService =
        Components.classes["@mozilla.org/uriloader/external-helper-app-service;1"]
                  .getService(Components.interfaces.nsIMIMEService);
    var mimeInfo = mimeInfoService.getFromTypeAndExtension(
        "application/x-userscript+javascript", "user.js" );
    mimeInfo.preferredAction = mimeInfo.useHelperApp;
    mimeInfo.preferredApplicationHandler = appFile;
    mimeInfo.launchWithFile(docFile);
  }
}

function parseScriptName(sourceUri) {
  var name = sourceUri.spec;
  name = name.substring(0, name.indexOf(".user.js"));
  name = name.substring(name.lastIndexOf("/") + 1);
  return name;
};

function getTempFile() {
  var file = Components.classes["@mozilla.org/file/directory_service;1"]
        .getService(Components.interfaces.nsIProperties)
        .get("TmpD", Components.interfaces.nsILocalFile);

  file.append("gm_" + new Date().getTime() + Math.floor(Math.random()*65536));
  if(file.exists()){
    return getTempFile();
  }

  return file;
};

function getBinaryContents(url){
    var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                              .getService(Components.interfaces.nsIIOService);

    var channel = ioService.newChannelFromURI(url);
    var input = channel.open();

    var bstream = Components.classes["@mozilla.org/binaryinputstream;1"]
                            .createInstance(Components.interfaces.nsIBinaryInputStream);
    bstream.setInputStream(input);

    var bytes = bstream.readBytes(bstream.available());

    return bytes;
};

function getContents(aURL, charset){
  if( !charset ) {
    charset = "UTF-8"
  }
  var ioService=Components.classes["@mozilla.org/network/io-service;1"]
    .getService(Components.interfaces.nsIIOService);
  var scriptableStream=Components
    .classes["@mozilla.org/scriptableinputstream;1"]
    .getService(Components.interfaces.nsIScriptableInputStream);
  // http://lxr.mozilla.org/mozilla/source/intl/uconv/idl/nsIScriptableUConv.idl
  var unicodeConverter = Components
    .classes["@mozilla.org/intl/scriptableunicodeconverter"]
    .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
  unicodeConverter.charset = charset;

  var channel=ioService.newChannelFromURI(aURL);
  var input=channel.open();
  scriptableStream.init(input);
  var str=scriptableStream.read(input.available());
  scriptableStream.close();
  input.close();

  try {
    return unicodeConverter.ConvertToUnicode(str);
  } catch( e ) {
    return str;
  }
};

function getWriteStream(file) {
  var stream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                         .createInstance(Components.interfaces.nsIFileOutputStream);

  stream.init(file, 0x02 | 0x08 | 0x20, 420, -1);

  return stream;
};

function getConfigFile(){
  var file = getScriptDir();
  file.append("config.xml");
  return file;
};

function getConfigFileURI(){
  return Components.classes["@mozilla.org/network/io-service;1"]
                   .getService(Components.interfaces.nsIIOService)
                   .newFileURI(getConfigFile());
};

function getDependencyFileURI(script, dep){
  return Components.classes["@mozilla.org/network/io-service;1"]
                   .getService(Components.interfaces.nsIIOService)
                   .newFileURI(getDependencyFile(script, dep));
};

function getDependencyFile(script, dep){
  var file = getScriptDir();
  file.append(script.basedir);
  file.append(dep.filename);
  return file;
};

function getScriptFileURI(script) {
  return Components.classes["@mozilla.org/network/io-service;1"]
                   .getService(Components.interfaces.nsIIOService)
                   .newFileURI(getScriptFile(script));
};

function getScriptBasedir(script) {
  var file = getScriptDir();
  file.append(script.basedir);
  return file;
};

function getScriptFile(script) {
  var file = getScriptDir();
  file.append(script.basedir);
  file.append(script.filename);
  return file;
};

function getScriptDir() {
  var dir = getNewScriptDir();

  if (dir.exists()) {
    return dir;
  } else {
    var oldDir = getOldScriptDir();
    if (oldDir.exists()) {
      return oldDir;
    } else {
      // if we called this function, we want a script dir.
      // but, at this branch, neither the old nor new exists, so create one
      return GM_createScriptsDir(dir);
    }
  }
};

function getNewScriptDir() {
  var file = Components.classes["@mozilla.org/file/directory_service;1"]
                       .getService(Components.interfaces.nsIProperties)
                       .get("ProfD", Components.interfaces.nsILocalFile);
  file.append("gm_scripts");
  return file;
};

function getOldScriptDir() {
  var file = getContentDir();
  file.append("scripts");
  return file;
};

function getContentDir() {
  var reg = Components.classes["@mozilla.org/chrome/chrome-registry;1"]
                      .getService(Components.interfaces.nsIChromeRegistry);

  var ioSvc = Components.classes["@mozilla.org/network/io-service;1"]
                        .getService(Components.interfaces.nsIIOService);

  var proto = Components.classes["@mozilla.org/network/protocol;1?name=file"]
                        .getService(Components.interfaces.nsIFileProtocolHandler);

  var chromeURL = ioSvc.newURI("chrome://greasemonkey/content", null, null);
  var fileURL = reg.convertChromeURL(chromeURL);
  var file = proto.getFileFromURLSpec(fileURL.spec).parent;

  return file
};

/**
 * Takes the place of the traditional prompt() function which became broken
 * in FF 1.0.1. :(
 */
function gmPrompt(msg, defVal, title) {
  var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                .getService(Components.interfaces.nsIPromptService);
  var result = {value:defVal};

  if (promptService.prompt(null, title, msg, result, null, {value:0})) {
    return result.value;
  }
  else {
    return null;
  }
};

function ge(id) {
  return window.document.getElementById(id);
};


function dbg(o) {
  var s = "";
  var i = 0;

  for (var p in o) {
    s += p + ":" + o[p] + "\n";

    if (++i % 15 == 0) {
      alert(s);
      s = "";
    }
  }

  alert(s);
};

function delaydbg(o) {
  setTimeout(function() {dbg(o);}, 1000);
};

function delayalert(s) {
  setTimeout(function() {alert(s);}, 1000);
};

function GM_isGreasemonkeyable(url) {
  var scheme = Components.classes["@mozilla.org/network/io-service;1"]
               .getService(Components.interfaces.nsIIOService)
               .extractScheme(url);

  return (scheme == "http" || scheme == "https" || scheme == "file" ||
          scheme == "ftp" || url.match(/^about:cache/)) &&
          !/hiddenWindow\.html$/.test(url);
};

function GM_isFileScheme(url) {
  var scheme = Components.classes["@mozilla.org/network/io-service;1"]
               .getService(Components.interfaces.nsIIOService)
               .extractScheme(url);

  return scheme == "file";
};

function GM_getEnabled() {
  return GM_prefRoot.getValue("enabled", true);
};

function GM_setEnabled(enabled) {
  GM_prefRoot.setValue("enabled", enabled);
};


/**
 * Logs a message to the console. The message can have python style %s
 * thingers which will be interpolated with additional parameters passed.
 */
function log(message) {
  if (GM_prefRoot.getValue("logChrome", false)) {
    logf.apply(null, arguments);
  }
};

function logf(message) {
  for (var i = 1; i < arguments.length; i++) {
    message = message.replace(/\%s/, arguments[i]);
  }

  dump(message + "\n");
};

/**
 * Loggifies an object. Every method of the object will have it's entrance,
 * any parameters, any errors, and it's exit logged automatically.
 */
function loggify(obj, name) {
  for (var p in obj) {
    if (typeof obj[p] == "function") {
      obj[p] = gen_loggify_wrapper(obj[p], name, p);
    }
  }
};

function gen_loggify_wrapper(meth, objName, methName) {
  return function() {
     var retVal;
    //var args = new Array(arguments.length);
    var argString = "";
    for (var i = 0; i < arguments.length; i++) {
      //args[i] = arguments[i];
      argString += arguments[i] + (((i+1)<arguments.length)? ", " : "");
    }

    log("> %s.%s(%s)", objName, methName, argString); //args.join(", "));

    try {
      return retVal = meth.apply(this, arguments);
    } finally {
      log("< %s.%s: %s",
          objName,
          methName,
          (typeof retVal == "undefined" ? "void" : retVal));
    }
  }
};

/**
 * Returns true if the given script should be invoked on url, otherwise false.
 */
function GM_scriptMatchesUrl(script, url) {
  for (var i = 0, glob; glob = script.includes[i]; i++) {
    var re = convert2RegExp(glob);
    if (re.test(url)) {
      for (var j = 0; glob = script.excludes[j]; j++) {
        re = convert2RegExp(glob);
        if (re.test(url))
          return false;
      }
      return true;
    }
  }
  return false;
}

/**
 * Returns an associative array from header name (sans @ prefix) to value.
 * Values are arrays, unless headerSpec[name] was 1, in which case the value
 * is a string only (the value of the last header with that name).
 *
 * If, instead of 1, a callback function is provided, the return value of that
 * callback becomes appended to the array instead. This callback is invoked
 * with two arguments: the raw header, and the array with all prior callback
 * results for this header (or the empty array).
 *
 * oldHeaders (optional) is used as the target object headers are appended to.
 */
function GM_parseScriptHeaders(source, headerSpec, oldHeaders) {
  var headerRe = /.*/;
  if (headerSpec) {
    var allHeaders = [];
    for (var header in headerSpec)
      allHeaders.push(header);
    headerRe = new RegExp("^(" + allHeaders.join("|") + ")$");
  }

  // read one line at a time looking for start meta delimiter or EOF
  var lines = source.match(/.+/g);
  var lnIdx = 0;
  var result;
  var foundMeta = false;
  var headers = oldHeaders || {};

  while ((result = lines[lnIdx++])) {
    if (result.indexOf("// ==UserScript==") == 0) {
      GM_log("* found metadata");
      foundMeta = true;
      break;
    }
  }

  // gather up meta lines
  if (foundMeta) {
    while ((result = lines[lnIdx++])) {
      if (result.indexOf("// ==/UserScript==") == 0) {
        break;
      }

      var match = result.match(/\/\/ \@(\S+)\s+([^\n]+)/);
      if (match != null) {
        var name = match[1], value = match[2];
        if (!name.match(headerRe))
          continue;
        if (headerSpec && headerSpec[name] == 1) {
          headers[name] = value; // only wanted the last value
        }
        else { // want an array of all values
          if (!headers.hasOwnProperty(name))
            headers[name] = [];
          var callback = headerSpec && headerSpec[name] ||
            function(header) { return header; };
          headers[name].push(callback(value, headers[name]));
        }
      }
    }
  }
  return headers;
};
