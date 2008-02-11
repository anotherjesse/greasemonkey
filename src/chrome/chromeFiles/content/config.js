// In this file protected properties (prefixed with an underscore) may be
// used anywhere within this file and versioning.js

function Config() {
  this.onload = null;
  this.scripts = null;
  this.configFile = this.scriptDir;
  this.configFile.append("config.xml");
};

Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
  .getService(Components.interfaces.mozIJSSubScriptLoader)
  .loadSubScript("chrome://greasemonkey/content/versioning.js");

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

Config.prototype.parse = function(source, uri)
{
  var ioservice = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService(Components.interfaces.nsIIOService);

  var script = new Script(this);
  script.enabled = true;
  script.includes = [];
  script.excludes = [];

  // read one line at a time looking for start meta delimiter or EOF
  var lines = source.match(/.+/g);
  var lnIdx = 0;
  var result = {};
  var foundMeta = false;

  while ((result = lines[lnIdx++])) {
    if (result.indexOf("// ==UserScript==") == 0) {
      foundMeta = true;
      break;
    }
  }

  // gather up meta lines
  if (foundMeta) {
    // used for duplicate resource name detection
    var previousResourceNames = {};

    while ((result = lines[lnIdx++])) {
      if (result.indexOf("// ==/UserScript==") == 0) {
        break;
      }

      var match = result.match(/\/\/ \@(\S+)\s+([^\n]+)/);
      if (match != null) {
        switch (match[1]) {
          case "name":
          case "namespace":
          case "description":
            script[match[1]] = match[2];
            break;
          case "include":
          case "exclude":
            script[match[1]+"s"].push(match[2]);
            break;
          case "require":
            var reqUri = ioservice.newURI(match[2], null, uri);
            var scriptRequire = new ScriptRequire(script);
            scriptRequire.url = reqUri.spec;
            script.requires.push(scriptRequire);
            break;
          case "resource":
            var res = match[2].match(/(\S+)\s+(.*)/);
            if (res === null) {
              // NOTE: Unlocalized strings
              throw new Error("Invalid syntax for @resource declaration '" +
                              match[2] + "'. Resources are declared like: " +
                              "@resource <name> <url>.");
            }

            var resName = res[1];
            if (previousResourceNames[resName]) {
              throw new Error("Duplicate resource name '" + resName + "' " +
                              "detected. Each resource must have a unique " +
                              "name.");
            } else {
              previousResourceNames[resName] = true;
            }

            var resUri = ioservice.newURI(res[2], null, uri);
            var scriptResource = new ScriptResource(script);
            scriptResource.name = resName;
            scriptResource.url = resUri.spec;
            script.resources.push(scriptResource);
            break;
        }
      }
    }
  }

  // if no meta info, default to reasonable values
  if (script.name == null) {
    script.name = parseScriptName(uri);
  }

  if (script.namespace == null) {
    script.namespace = uri.host;
  }

  if (script.includes.length == 0) {
    script.includes.push("*");
  }

  return script;
}

Config.prototype.install = function(script) {
  GM_log("> Config.install");

  try {
    var existingIndex = this.find(script.namespace, script.name);
    if (existingIndex > -1)
      this.uninstall(this.scripts[existingIndex], false);

    script._initFile(script.tempFile);
    script.tempFile = null;

    for (var i = 0; i < script.requires.length; i++)
      script.requires[i]._initFile();

    for (var i = 0; i < script.resources.length; i++)
      script.resources[i]._initFile();

    this.scripts.push(script);
    this.save();

    GM_log("< Config.install");
  } catch (e2) {
    // NOTE: unlocalised string
    alert("Error installing user script:\n\n" + (e2 ? e2 : ""));
    throw e2;
  }
};

Config.prototype.uninstall = function(script, uninstallPrefs)
{
  var idx = this.find(script.namespace, script.name);
  this.scripts.splice(idx, 1);

  if (script.basedir) // if script has its own dir, remove the dir + contents
    script.basedirFile.remove(true);
  else // if script is in the root, just remove the file
    script.file.remove(false);

  if (uninstallPrefs) // Remove saved preferences
     GM_prefRoot.remove("scriptvals." + script.namespace + "/" + script.name + ".");
}

/**
 * Moves an installed user script to a new position in the array of installed scripts.
 *
 * @param script The script to be moved.
 * @param destination Can be either (a) a numeric offset for the script to be
 *                    moved or (b) another installet script to which position
 *                    the script will be moved.
 */
Config.prototype.move = function(script, destination)
{
  var from = this.scripts.indexOf(script);
  var to = -1;

  // Make sure the user script is installed
  if (from == -1)
    return null;

  if (typeof destination == 'number') { // if destination is an offset
    to = from + destination;
    to = Math.max(0, to);
    to = Math.min(this.scripts.length - 1, to);
  } else { // if destination is a script object
    to = this.scripts.indexOf(destination);
  }

  if (to == -1)
    return null;

  var tmp = this.scripts.splice(from, 1)[0];
  this.scripts.splice(to, 0, tmp);

  return {from: from, to: to};
};

Config.prototype.__defineGetter__("scriptDir", function() {
  var newDir = this.newScriptDir;
  if (newDir.exists())
    return newDir;

  var oldDir = this.oldScriptDir;
  if (oldDir.exists())
    return oldDir;

  // if we called this function, we want a script dir.
  // but, at this branch, neither the old nor new exists, so create one
  newDir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0755);

  var defaultConfigFile = getContentDir();
  defaultConfigFile.append("default-config.xml");

  defaultConfigFile.copyTo(newDir, "config.xml");
  defaultConfigFile.permissions = 0644;

  return newDir;
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
  },

  _initFileName: function(name, useExt)
  {
    var ext = "";
    name = name.toLowerCase();

    var dotIndex = name.lastIndexOf(".");
    if (dotIndex > 0 && useExt) {
      ext = name.substring(dotIndex + 1);
      name = name.substring(0, dotIndex);
    }

    name = name.replace(/[^A-Z0-9_]/gi, "");
    ext = ext.replace(/[^A-Z0-9_]/gi, "");

    // If no Latin characters found - use default
    if (!name)
      name = "gm_script";

    // 24 is a totally arbitrary max length
    if (name.length > 24)
      name = name.substring(0, 24);

    if (ext)
      name += "." + ext;
  
    return name;
  },

  _initFile: function(tempFile)
  {
    var file = this._config.scriptDir;
    var name = this._initFileName(this.name, false);

    file.append(name);
    file.createUnique(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0755);
    this.basedir = file.leafName;

    file.append(name + ".user.js");
    file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0644);
    this.filename = file.leafName;

    GM_log("Moving script file from " + tempFile.path + " to " + file.path);

    file.remove(true);
    tempFile.moveTo(file.parent, file.leafName);
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
  },

  _initFile: function()
  {
    var name = this.url.substr(this.url.lastIndexOf("/") + 1);
    if(name.indexOf("?") > 0)
      name = name.substr(0, name.indexOf("?"));
    name = this._script._initFileName(name, true);

    var file = this._script.basedirFile;
    file.append(name);
    file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0644);
    this.filename = file.leafName;

    GM_log("Moving dependency file from " + this.tempFile.path + " to " + file.path);

    file.remove(true);
    this.tempFile.moveTo(file.parent, file.leafName);
    this.tempFile = null;
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
  },
  
  _initFile: ScriptRequire.prototype._initFile
}
