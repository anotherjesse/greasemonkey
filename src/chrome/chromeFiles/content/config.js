function Config() {
  this.onload = null;
  this.scripts = null;
  this.configFile = this.scriptDir;
  this.configFile.append("config.xml");
};

Config.prototype.find = function(namespace, name) {
  namespace = namespace.toLowerCase();
  name = name.toLowerCase();

  for (var i = 0, script = null; (script = this.scripts[i]); i++) {
    if (script.namespace.toLowerCase() == namespace && script.name.toLowerCase() == name) {
      return i;
    }
  }

  return -1;
};

Config.prototype.initFilename = function(script) {
  var index = {};
  var base = script.name.replace(/[^A-Z0-9_]/gi, "").toLowerCase();

  // If no Latin characters found - use default
  if (!base) {
    base = "gm_script";
  }

  // 24 is a totally arbitrary max length
  if (base.length > 24) {
    base = base.substring(0, 24);
  }

  for (var i = 0; i < this.scripts.length; i++) {
    index[this.scripts[i].basedir] = this.scripts[i];
  }

  if (!index[base]) {
    script.filename = base + ".user.js";
    script.basedir = base;
    return;
  }

  for (var count = 1; count < Number.MAX_VALUE; count++) {
    if (!index[base + count]) {
      script.filename = base + ".user.js";
      script.basedir = base + "("+ count + ")";
      return;
    }

    if (!index[filename]) {
      // Check to make sure there's no file already in that space.
      var file = this.scriptDir.clone();
      file.append(filename);
      if (!file.exists()) {
        script.filename = filename;
        return;
      }
    }
  }
  // NOTE: non localised string
  throw new Error("doooooooode. get some different user script or something.");
};

Config.prototype.initDependencyFilename = function(script, req) {
  var remoteFilename = req.url.substr(req.url.lastIndexOf("/") + 1);

  if(remoteFilename.indexOf("?")>0){
    remoteFilename = remoteFilename.substr(0, remoteFilename.indexOf("?"));
  }

  var dotIndex = remoteFilename.lastIndexOf(".");
  if (dotIndex > 0) {
    var base = remoteFilename.substring(0, dotIndex);
    var ext = remoteFilename.substring(dotIndex+1);
  } else {
    var base = remoteFilename;
    var ext = "";
  }

  ext = ext.replace(/[^A-Z0-9_]/gi, "");
  base = base.replace(/[^A-Z0-9_]/gi, "");

  if (base.length > 24) {
    base = base.substring(0, 24);
  }

  if (ext.length > 0){
    ext = "."+ext;
  }

  for (var count = 0; count < Number.MAX_VALUE; count++) {
    var stamp = (count > 0) ? "(" + count + ")" : "";
    var filename = base + stamp + ext;
    var file = script.basedirFile;
    file.append(filename);

    if (!file.exists()) {
      return filename;
    }
  }
  return undefined;
}

Config.prototype.load = function() {
  var domParser = Components.classes["@mozilla.org/xmlextras/domparser;1"]
                            .createInstance(Components.interfaces.nsIDOMParser);

  var configContents = getContents(this.configFile);
  var doc = domParser.parseFromString(configContents, "text/xml");
  var nodes = doc.evaluate("/UserScriptConfig/Script", doc, null, 0, null);

  this.scripts = [];

  for (var node = null; (node = nodes.iterateNext()); ) {
    var script = new Script(this);

    for (var i = 0, childNode = null; (childNode = node.childNodes[i]); i++) {
      if (childNode.nodeName == "Include") {
        script.includes.push(childNode.firstChild.nodeValue);
      } else if (childNode.nodeName == "Exclude") {
        script.excludes.push(childNode.firstChild.nodeValue);
      } else if (childNode.nodeName == "Require") {
        var scriptRequire = new ScriptRequire(script);
        scriptRequire.filename = childNode.getAttribute("filename");
        script.requires.push(scriptRequire);
      } else if (childNode.nodeName == "Resource") {
        var scriptResource = new ScriptResource(script);
        scriptResource.name = childNode.getAttribute("name");
        scriptResource.filename = childNode.getAttribute("filename");
        scriptResource.mimetype = childNode.getAttribute("mimetype");
        scriptResource.charset  = childNode.getAttribute("charset");
        script.resources.push(scriptResource);
      }
    }

    script.filename = node.getAttribute("filename");
    script.name = node.getAttribute("name");
    script.namespace = node.getAttribute("namespace");
    script.description = node.getAttribute("description");
    script.enabled = node.getAttribute("enabled") == true.toString();
    script.basedir = node.getAttribute("basedir") || ".";

    this.scripts.push(script);
  }
};

Config.prototype.save = function() {
  var doc = document.implementation.createDocument("", "UserScriptConfig", null);

  for (var i = 0, scriptObj = null; (scriptObj = this.scripts[i]); i++) {
    var scriptNode = doc.createElement("Script");

    for (var j = 0; j < scriptObj.includes.length; j++) {
      var includeNode = doc.createElement("Include");
      includeNode.appendChild(doc.createTextNode(scriptObj.includes[j]));
      scriptNode.appendChild(doc.createTextNode("\n\t\t"));
      scriptNode.appendChild(includeNode);
    }

    for (var j = 0; j < scriptObj.excludes.length; j++) {
      var excludeNode = doc.createElement("Exclude");
      excludeNode.appendChild(doc.createTextNode(scriptObj.excludes[j]));
      scriptNode.appendChild(doc.createTextNode("\n\t\t"));
      scriptNode.appendChild(excludeNode);
    }

    for (var j = 0; j < scriptObj.requires.length; j++) {
      var req = scriptObj.requires[j];
      var resourceNode = doc.createElement("Require");

      resourceNode.setAttribute("filename", req.filename);

      scriptNode.appendChild(doc.createTextNode("\n\t\t"));
      scriptNode.appendChild(resourceNode);
    }

    for (var j = 0; j< scriptObj.resources.length; j++) {
      var imp = scriptObj.resources[j];
      var resourceNode = doc.createElement("Resource");

      resourceNode.setAttribute("name", imp.name);
      resourceNode.setAttribute("filename", imp.filename);
      resourceNode.setAttribute("mimetype", imp.mimetype);
      if (imp.charset) {
        resourceNode.setAttribute("charset", imp.charset);
      }

      scriptNode.appendChild(doc.createTextNode("\n\t\t"));
      scriptNode.appendChild(resourceNode);
    }

    scriptNode.appendChild(doc.createTextNode("\n\t"));

    scriptNode.setAttribute("filename", scriptObj.filename);
    scriptNode.setAttribute("name", scriptObj.name);
    scriptNode.setAttribute("namespace", scriptObj.namespace);
    scriptNode.setAttribute("description", scriptObj.description);
    scriptNode.setAttribute("enabled", scriptObj.enabled);
    scriptNode.setAttribute("basedir", scriptObj.basedir);

    doc.firstChild.appendChild(doc.createTextNode("\n\t"));
    doc.firstChild.appendChild(scriptNode);
  }

  doc.firstChild.appendChild(doc.createTextNode("\n"));

  var configStream = getWriteStream(this.configFile);
  new XMLSerializer().serializeToStream(doc, configStream, "utf-8");
  configStream.close();
};

Config.prototype.install = function(script) {
  GM_log("> Config.install");

  try {
    // initialize a new script object
    script.filename = script.tempFile.leafName;

    var newDir = this.scriptDir;
    var existingIndex = this.find(script.namespace, script.name);
    var existingFile = null;
    var oldScripts = new Array(this.scripts);

    if (existingIndex > -1) {
        existingFile = this.scripts[existingIndex].basedirFile;
        existingFile.normalize();
        if (existingFile.equals(this.scriptDir)) {
          existingFile = this.scripts[existingIndex].file;
        }
        if (existingFile.exists()) {
          existingFile.remove(true);
        }
        this.scripts.splice(existingIndex, 1);
    }

    this.initFilename(script);
    newDir.append(script.basedir);
    script.tempFile.copyTo(newDir, script.filename);

    for (var i = 0; i < script.requires.length; i++) {
      this.installDependency(script, script.requires[i]);
    }

    for (var i = 0; i < script.resources.length; i++) {
      this.installDependency(script, script.resources[i]);
    }

    this.scripts.push(script);
    this.save();

    GM_log("< Config.install");
  } catch (e2) {
    // NOTE: unlocalised string
    alert("Error installing user script:\n\n" + (e2 ? e2 : ""));
  }
};

Config.prototype.installDependency = function(script, req){
  GM_log("Installing dependency: " + req.url  + " from " + req.tempFile.path);

  var scriptDir = this.scriptDir;
  GM_log("Installing to " + script.basedir);
  scriptDir.append(script.basedir);

  req.filename = this.initDependencyFilename(script, req);
  GM_log("Installing as: " + req.filename);

  try {
    req.tempFile.copyTo(scriptDir, req.filename)
  } catch(e) {
    throw e;
  }
};

Config.prototype.__defineGetter__("scriptDir", function() {
  var dir = this.newScriptDir;

  if (dir.exists()) {
    return dir;
  } else {
    var oldDir = this.oldScriptDir;
    if (oldDir.exists()) {
      return oldDir;
    } else {
      // if we called this function, we want a script dir.
      // but, at this branch, neither the old nor new exists, so create one
      return GM_createScriptsDir(dir);
    }
  }
});

Config.prototype.__defineGetter__("newScriptDir", function() {
  var file = Components.classes["@mozilla.org/file/directory_service;1"]
                       .getService(Components.interfaces.nsIProperties)
                       .get("ProfD", Components.interfaces.nsILocalFile);
  file.append("gm_scripts");
  return file;
});

Config.prototype.__defineGetter__("oldScriptDir", function() {
  var file = getContentDir();
  file.append("scripts");
  return file;
});

function Script(config)
{
  this._config = config;
  this.tempFile = null; // Only for scripts not installed
  this.filename = null;
  this.name = null;
  this.namespace = null;
  this.description = null;
  this.enabled = true;
  this.includes = [];
  this.excludes = [];
  this.basedir = null;
  this.requires = [];
  this.resources = [];
}

Script.prototype = {
  get file()
  {
    var file = this.basedirFile;
    file.append(this.filename);
    return file;
  },

  get basedirFile()
  {
    var file = this._config.scriptDir;
    file.append(this.basedir);
    return file;
  }
}

function ScriptRequire(script)
{
  this._script = script;
  this.url = null; // Only for scripts not installed
  this.tempFile = null; // Only for scripts not installed
  this.filename = null;
}

ScriptRequire.prototype = {
  get file()
  {
    var file = this._script.basedirFile;
    file.append(this.filename);
    return file;
  }
}

function ScriptResource(script)
{
  this._script = script;
  this.url = null; // Only for scripts not installed
  this.tempFile = null; // Only for scripts not installed
  this.name = null;
  this.filename = null;
  this.mimetype = null;
  this.charset = null;
}

ScriptResource.prototype = {
  get file()
  {
    var file = this._script.basedirFile;
    file.append(this.filename);
    return file;
  }
}
