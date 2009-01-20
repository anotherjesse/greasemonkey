function Config() {
  this._scripts = null;
  this._runnable = null;
  this._scriptsIdx = {};
  this._configFile = this._scriptDir;
  this._configFile.append("config.xml");
  this._initScriptDir();

  this._observers = [];

  this._updateVersion();
  this._load();
}

Config.prototype = {
  addObserver: function(observer, script) {
    var observers = script ? script._observers : this._observers;
    observers.push(observer);
  },

  removeObserver: function(observer, script) {
    var observers = script ? script._observers : this._observers;
    var index = observers.indexOf(observer);
    if (index == -1) throw new Error("Observer not found");
    observers.splice(index, 1);
  },

  _notifyObservers: function(script, event, data) {
    var observers = this._observers.concat(script._observers);
    for (var i = 0, observer; observer = observers[i]; i++) {
      observer.notifyEvent(script, event, data);
    }
  },

  _changed: function(script, event, data) {
    this._save();
    this._notifyObservers(script, event, data);
  },

  installIsUpdate: function(script) {
    return this._find(script);
  },

  /**
   * Find an installed script, by (namespace;name) or downloadURL
   */
  _find: function(aScript) {
    var namespace = aScript._namespace ?
                    aScript._namespace.toLowerCase() : null;
    var name = aScript._name ? aScript._name.toLowerCase() : null;
    // Search in the scripts index
    if (namespace && name)
      if (this._scriptsIdx[namespace] && this._scriptsIdx[namespace][name])
        return this._scriptsIdx[namespace][name];
    // Search by downloadURL (only useful for dependencies)
    var downloadURL = aScript._downloadURL;
    if (!downloadURL)
      return null;
    for (var i in this._scripts) {
      var script = this._scripts[i];
      if (script._downloadURL!=downloadURL)
        continue;
//      if (namespace && name)
//        throw new Error("Different (namespace;name), same downloadURL");
      return script;
    }
    return null;
  },

  _load: function() {
    var domParser = Components.classes["@mozilla.org/xmlextras/domparser;1"]
                              .createInstance(Components.interfaces.nsIDOMParser);

    var configContents = getContents(this._configFile);
    var doc = domParser.parseFromString(configContents, "text/xml");
    var nodes = doc.evaluate("/UserScriptConfig/Script", doc, null, 0, null);

    this._scripts = [];

    for (var node = null; node = nodes.iterateNext(); ) {
      var script = new Script(this);

      for (var i = 0, childNode; childNode = node.childNodes[i]; i++) {
        switch (childNode.nodeName) {
        case "Include":
          script._includes.push(childNode.firstChild.nodeValue);
          break;
        case "Exclude":
          script._excludes.push(childNode.firstChild.nodeValue);
          break;
        case "Depend":
          var scriptDepend = new ScriptDependency();
          scriptDepend.load(childNode);
          script._module.addDependency(scriptDepend);
          break;
        case "Require":
          var scriptRequire = new ScriptRequire(script);
          scriptRequire._filename = childNode.getAttribute("filename");
          script._requires.push(scriptRequire);
          break;
        case "Resource":
          var scriptResource = new ScriptResource(script);
          scriptResource._name = childNode.getAttribute("name");
          scriptResource._filename = childNode.getAttribute("filename");
          scriptResource._mimetype = childNode.getAttribute("mimetype");
          scriptResource._charset = childNode.getAttribute("charset");
          script._resources.push(scriptResource);
          break;
        case "Unwrap":
          script._unwrap = true;
          break;
        }
      }

      script._filename = node.getAttribute("filename");
      script._name = node.getAttribute("name");
      script._namespace = node.getAttribute("namespace");
      script._description = node.getAttribute("description");
      script._enabled = node.getAttribute("enabled") == true.toString();
      script._basedir = node.getAttribute("basedir") || ".";
      script._downloadURL = node.getAttribute("downloadURL");

      this._scripts.push(script);
      // Populate scripts index
      var namespace = script._namespace.toLowerCase();
      var name = script._name.toLowerCase();
      var nameIdx = this._scriptsIdx[namespace];
      if (!nameIdx)
        nameIdx = this._scriptsIdx[namespace] = {};
      nameIdx[name] = script;
    }

    this._resolveDep();
  },

  _save: function() {
    var doc = Components.classes["@mozilla.org/xmlextras/domparser;1"]
      .createInstance(Components.interfaces.nsIDOMParser)
      .parseFromString("<UserScriptConfig></UserScriptConfig>", "text/xml");

    for (var i = 0, scriptObj; scriptObj = this._scripts[i]; i++) {
      var scriptNode = doc.createElement("Script");

      for (var j = 0; j < scriptObj._includes.length; j++) {
        var includeNode = doc.createElement("Include");
        includeNode.appendChild(doc.createTextNode(scriptObj._includes[j]));
        scriptNode.appendChild(doc.createTextNode("\n\t\t"));
        scriptNode.appendChild(includeNode);
      }

      for (var j = 0; j < scriptObj._excludes.length; j++) {
        var excludeNode = doc.createElement("Exclude");
        excludeNode.appendChild(doc.createTextNode(scriptObj._excludes[j]));
        scriptNode.appendChild(doc.createTextNode("\n\t\t"));
        scriptNode.appendChild(excludeNode);
      }

      scriptObj._module.save(scriptNode, doc);

      for (var j = 0; j < scriptObj._requires.length; j++) {
        var req = scriptObj._requires[j];
        var resourceNode = doc.createElement("Require");

        resourceNode.setAttribute("filename", req._filename);

        scriptNode.appendChild(doc.createTextNode("\n\t\t"));
        scriptNode.appendChild(resourceNode);
      }

      for (var j = 0; j < scriptObj._resources.length; j++) {
        var imp = scriptObj._resources[j];
        var resourceNode = doc.createElement("Resource");

        resourceNode.setAttribute("name", imp._name);
        resourceNode.setAttribute("filename", imp._filename);
        resourceNode.setAttribute("mimetype", imp._mimetype);
        if (imp._charset) {
          resourceNode.setAttribute("charset", imp._charset);
        }

        scriptNode.appendChild(doc.createTextNode("\n\t\t"));
        scriptNode.appendChild(resourceNode);
      }

      if (scriptObj._unwrap) {
        scriptNode.appendChild(doc.createTextNode("\n\t\t"));
        scriptNode.appendChild(doc.createElement("Unwrap"));
      }

      scriptNode.appendChild(doc.createTextNode("\n\t"));

      scriptNode.setAttribute("filename", scriptObj._filename);
      scriptNode.setAttribute("name", scriptObj._name);
      scriptNode.setAttribute("namespace", scriptObj._namespace);
      scriptNode.setAttribute("description", scriptObj._description);
      scriptNode.setAttribute("enabled", scriptObj._enabled);
      scriptNode.setAttribute("basedir", scriptObj._basedir);
      if (scriptObj._downloadURL)
        scriptNode.setAttribute("downloadURL", scriptObj._downloadURL);

      doc.firstChild.appendChild(doc.createTextNode("\n\t"));
      doc.firstChild.appendChild(scriptNode);
    }

    doc.firstChild.appendChild(doc.createTextNode("\n"));

    var configStream = getWriteStream(this._configFile);
    Components.classes["@mozilla.org/xmlextras/xmlserializer;1"]
      .createInstance(Components.interfaces.nsIDOMSerializer)
      .serializeToStream(doc, configStream, "utf-8");
    configStream.close();
  },

  parse: function(source, uri) {
    var ioservice = Components.classes["@mozilla.org/network/io-service;1"]
                              .getService(Components.interfaces.nsIIOService);

    var script = new Script(this);
    script._downloadURL = uri.spec;
    script._enabled = true;

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

        var match = result.match(/\/\/ \@(\S+)(?:\s+([^\n]+))?/);
        if (match === null) continue;

        var header = match[1];
        var value = match[2];
        if (value) { // @header <value>
          switch (header) {
            case "name":
            case "namespace":
            case "description":
              script["_" + header] = value;
              break;
            case "include":
              script._includes.push(value);
              break;
            case "exclude":
              script._excludes.push(value);
              break;
            case "depend":
              var scriptDepend = new ScriptDependency();
              scriptDepend.parse(match[2], ioservice, uri);
              script._module.addDependency(scriptDepend);
              break;
            case "require":
              var reqUri = ioservice.newURI(value, null, uri);
              var scriptRequire = new ScriptRequire(script);
              scriptRequire._downloadURL = reqUri.spec;
              script._requires.push(scriptRequire);
              break;
            case "resource":
              var res = value.match(/(\S+)\s+(.*)/);
              if (res === null) {
                // NOTE: Unlocalized strings
                throw new Error("Invalid syntax for @resource declaration '" +
                                value + "'. Resources are declared like: " +
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
              scriptResource._name = resName;
              scriptResource._downloadURL = resUri.spec;
              script._resources.push(scriptResource);
              break;
          }
        } else { // plain @header
          switch (header) {
            case "unwrap":
              script._unwrap = true;
              break;
          }
        }
      }
    }

    // if no meta info, default to reasonable values
    if (script._name == null) script._name = parseScriptName(uri);
    if (script._namespace == null) script._namespace = uri.host;
    if (!script._description) script._description = "";
    if (script._includes.length == 0) script._includes.push("*");

    return script;
  },

  install: function(script) {
    GM_log("> Config.install");

    var existing = this._find(script);
    if (existing)
      this.uninstall(existing, false);

    script._module.init(this);

    script._initFile(script._tempFile);
    script._tempFile = null;

    for (var i = 0; i < script._requires.length; i++) {
      script._requires[i]._initFile();
    }

    for (var i = 0; i < script._resources.length; i++) {
      script._resources[i]._initFile();
    }

    this._scripts.push(script);
    // Add script to index
    var namespace = script._namespace.toLowerCase();
    var name = script._name.toLowerCase();
    var nameIdx = this._scriptsIdx[namespace];
    if (!nameIdx)
      nameIdx = this._scriptsIdx[namespace] = {};
    nameIdx[name] = script;

    this._resolveDep();
    this._changed(script, "install", null);

    GM_log("< Config.install");
  },

  uninstall: function(script, uninstallPrefs) {
    script._module.destroy();
    var idx = this._scripts.indexOf(script);
    this._scripts.splice(idx, 1);

    // Remove script from index
    var namespace = script._namespace.toLowerCase();
    var name = script._name.toLowerCase();
    var nameIdx = this._scriptsIdx[namespace];
    nameIdx[name] = null;
    var empty = true;
    for (var s in nameIdx)
      if (nameIdx[s]) {
        empty = false;
        break;
      }

    this._resolveDep();
    this._changed(script, "uninstall", null);

    // watch out for cases like basedir="." and basedir="../gm_scripts"
    if (!script._basedirFile.equals(this._scriptDir)) {
      // if script has its own dir, remove the dir + contents
      script._basedirFile.remove(true);
    } else {
      // if script is in the root, just remove the file
      script._file.remove(false);
    }

    if (uninstallPrefs) {
      // Remove saved preferences
      GM_prefRoot.remove("scriptvals." + script._namespace + "/" + script._name + ".");
    }
  },

  /**
   * Moves an installed user script to a new position in the array of installed scripts.
   *
   * @param script The script to be moved.
   * @param destination Can be either (a) a numeric offset for the script to be
   *                    moved or (b) another installet script to which position
   *                    the script will be moved.
   */
  move: function(script, destination) {
    var from = this._scripts.indexOf(script);
    var to = -1;

    // Make sure the user script is installed
    if (from == -1) return;

    if (typeof destination == "number") { // if destination is an offset
      to = from + destination;
      to = Math.max(0, to);
      to = Math.min(this._scripts.length - 1, to);
    } else { // if destination is a script object
      to = this._scripts.indexOf(destination);
    }

    if (to == -1) return;

    var tmp = this._scripts.splice(from, 1)[0];
    this._scripts.splice(to, 0, tmp);
    this._changed(script, "move", to);
  },

  get _scriptDir() {
    var file = Components.classes["@mozilla.org/file/directory_service;1"]
                         .getService(Components.interfaces.nsIProperties)
                         .get("ProfD", Components.interfaces.nsILocalFile);
    file.append("gm_scripts");
    return file;
  },

  /**
   * Create an empty configuration if none exist.
   */
  _initScriptDir: function() {
    var dir = this._scriptDir;

    if (!dir.exists()) {
      dir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0755);

      var configStream = getWriteStream(this._configFile);
      var xml = "<UserScriptConfig/>";
      configStream.write(xml, xml.length);
      configStream.close();
    }
  },

  _resolveDep: function() {
    // init modules
    var scripts = this.scripts;
    for (var i in scripts)
      scripts[i]._module.init(this);
    // resolve dependency order
    for (var i in scripts)
      scripts[i]._module.resolveDep();
    // build runnable scripts array
    var runnable = this.scripts;
    for (var i=0; i<runnable.length;) {
      if (runnable[i].enabled)
        i++;
      else
        runnable.splice(i, 1);
    }
    this._runnable = runnable;
  },

  get scripts() { return this._scripts.concat(); },
  get runnable() { return this._runnable.concat(); },
  getMatchingScripts: function(testFunc) { return this._scripts.filter(testFunc); },

  /**
   * Checks whether the version has changed since the last run and performs
   * any necessary upgrades.
   */
  _updateVersion: function() {
    log("> GM_updateVersion");

    // this is the last version which has been run at least once
    var initialized = GM_prefRoot.getValue("version", "0.0");

    if (GM_compareVersions(initialized, "0.8") == -1)
      this._pointEightBackup();

    // update the currently initialized version so we don't do this work again.
    var extMan = Components.classes["@mozilla.org/extensions/manager;1"]
      .getService(Components.interfaces.nsIExtensionManager);

    var item = extMan.getItemForID(GM_GUID);
    GM_prefRoot.setValue("version", item.version);

    log("< GM_updateVersion");
  },

  /**
   * In Greasemonkey 0.8 there was a format change to the gm_scripts folder and
   * testing found several bugs where the entire folder would get nuked. So we
   * are paranoid and backup the folder the first time 0.8 runs.
   */
  _pointEightBackup: function() {
    var scriptDir = this._scriptDir;
    var scriptDirBackup = scriptDir.clone();
    scriptDirBackup.leafName += "_08bak";
    if (scriptDir.exists() && !scriptDirBackup.exists())
      scriptDir.copyTo(scriptDirBackup.parent, scriptDirBackup.leafName);
  }
};

function Script(config) {
  this._config = config;
  this._observers = [];

  this._downloadURL = null;
  this._tempFile = null; // Only for scripts not installed
  this._basedir = null;
  this._filename = null;

  this._name = null;
  this._namespace = null;
  this._description = null;
  this._enabled = true;
  this._includes = [];
  this._excludes = [];
  this._module = new ScriptModule(this);
  this._requires = [];
  this._resources = [];
  this._unwrap = false;
}

Script.prototype = {
  matchesURL: function(url) {
    function test(page) {
      return convert2RegExp(page).test(url);
    }

    return this._includes.some(test) && !this._excludes.some(test);
  },

  _changed: function(event, data) { this._config._changed(this, event, data); },

  get name() { return this._name; },
  get namespace() { return this._namespace; },
  get description() { return this._description; },
  get enabled() { return this._enabled; },
  set enabled(enabled) { this._enabled = enabled; this._changed("edit-enabled", enabled); },

  get includes() { return this._includes.concat(); },
  get excludes() { return this._excludes.concat(); },
  addInclude: function(url) { this._includes.push(url); this._changed("edit-include-add", url); },
  removeIncludeAt: function(index) { this._includes.splice(index, 1); this._changed("edit-include-remove", index); },
  addExclude: function(url) { this._excludes.push(url); this._changed("edit-exclude-add", url); },
  removeExcludeAt: function(index) { this._excludes.splice(index, 1); this._changed("edit-exclude-remove", index); },

  get requires() { return this._requires.concat(); },
  get resources() { return this._resources.concat(); },
  get unwrap() { return this._unwrap; },

  get _file() {
    var file = this._basedirFile;
    file.append(this._filename);
    return file;
  },

  get editFile() { return this._file; },

  get _basedirFile() {
    var file = this._config._scriptDir;
    file.append(this._basedir);
    file.normalize();
    return file;
  },

  get fileURL() { return GM_getUriFromFile(this._file).spec; },
  get textContent() { return getContents(this._file); },

  _initFileName: function(name, useExt) {
    var ext = "";
    name = name.toLowerCase();

    var dotIndex = name.lastIndexOf(".");
    if (dotIndex > 0 && useExt) {
      ext = name.substring(dotIndex + 1);
      name = name.substring(0, dotIndex);
    }

    name = name.replace(/\s+/g, "_").replace(/[^-_A-Z0-9]+/gi, "");
    ext = ext.replace(/\s+/g, "_").replace(/[^-_A-Z0-9]+/gi, "");

    // If no Latin characters found - use default
    if (!name) name = "gm_script";

    // 24 is a totally arbitrary max length
    if (name.length > 24) name = name.substring(0, 24);

    if (ext) name += "." + ext;

    return name;
  },

  _initFile: function(tempFile) {
    var file = this._config._scriptDir;
    var name = this._initFileName(this._name, false);

    file.append(name);
    file.createUnique(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0755);
    this._basedir = file.leafName;

    file.append(name + ".user.js");
    file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0644);
    this._filename = file.leafName;

    GM_log("Moving script file from " + tempFile.path + " to " + file.path);

    file.remove(true);
    tempFile.moveTo(file.parent, file.leafName);
  },

  get urlToDownload() { return this._downloadURL; },
  setDownloadedFile: function(file) { this._tempFile = file; },

  get previewURL() {
    return Components.classes["@mozilla.org/network/io-service;1"]
                     .getService(Components.interfaces.nsIIOService)
                     .newFileURI(this._tempFile).spec;
  }
};

function ScriptRequire(script) {
  this._script = script;

  this._downloadURL = null; // Only for scripts not installed
  this._tempFile = null; // Only for scripts not installed
  this._filename = null;
}

ScriptRequire.prototype = {
  get _file() {
    var file = this._script._basedirFile;
    file.append(this._filename);
    return file;
  },

  get fileURL() { return GM_getUriFromFile(this._file).spec; },
  get textContent() { return getContents(this._file); },

  _initFile: function() {
    var name = this._downloadURL.substr(this._downloadURL.lastIndexOf("/") + 1);
    if(name.indexOf("?") > 0) {
      name = name.substr(0, name.indexOf("?"));
    }
    name = this._script._initFileName(name, true);

    var file = this._script._basedirFile;
    file.append(name);
    file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0644);
    this._filename = file.leafName;

    GM_log("Moving dependency file from " + this._tempFile.path + " to " + file.path);

    file.remove(true);
    this._tempFile.moveTo(file.parent, file.leafName);
    this._tempFile = null;
  },

  get urlToDownload() { return this._downloadURL; },
  setDownloadedFile: function(file) { this._tempFile = file; }
};

function ScriptResource(script) {
  this._script = script;

  this._downloadURL = null; // Only for scripts not installed
  this._tempFile = null; // Only for scripts not installed
  this._filename = null;
  this._mimetype = null;
  this._charset = null;

  this._name = null;
}

ScriptResource.prototype = {
  get name() { return this._name; },

  get _file() {
    var file = this._script._basedirFile;
    file.append(this._filename);
    return file;
  },

  get textContent() { return getContents(this._file); },

  get dataContent() {
    var appSvc = Components.classes["@mozilla.org/appshell/appShellService;1"]
                           .getService(Components.interfaces.nsIAppShellService);

    var window = appSvc.hiddenDOMWindow;
    var binaryContents = getBinaryContents(this._file);

    var mimetype = this._mimetype;
    if (this._charset && this._charset.length > 0) {
      mimetype += ";charset=" + this._charset;
    }

    return "data:" + mimetype + ";base64," +
      window.encodeURIComponent(window.btoa(binaryContents));
  },

  _initFile: ScriptRequire.prototype._initFile,

  get urlToDownload() { return this._downloadURL; },
  setDownloadedFile: function(tempFile, mimetype, charset) {
    this._tempFile = tempFile;
    this._mimetype = mimetype;
    this._charset = charset;
  }
};

/*
 * Encapsulates module related features
 */
function ScriptModule(script) {
  this.script = script;
  this.dependencies = [];
  this.dependents = [];
  this.resourceNames = {};
  this.enabled = true;
}

ScriptModule.prototype = {
  init: function(config) {
    this.enabled = this.script._enabled;
    if (!this.enabled)
      return;
    for (var i in this.dependencies) {
      var dep = this.dependencies[i];
      var module = dep.init(config);
      if (!module) {
        // missing dependency
        this.enabled = false;
        return;
      }
      module.addDependent(dep);
    }
  },

  destroy: function() {
    // clean dependencies
    for (var i in this.dependencies) {
      var dep = this.dependencies[i];
      var module = dep.dependency;
      if (module)
        module.removeDependent(dep);
    }
    // update dependents
    for (var i in this.dependents)
      this.dependents[i].clear();
  },

  addDependency: function(dep) {
    // assert resourceName is unique
    var name = dep.resourceName;
    if (name) {
      if (this.resourceNames[name]==true)
        throw new Error("Duplicate resource name '"+ name +"' detected in "+
          "script '"+ this.script._name +"' ("+ this.script._namespace +"). "+
          "Dependency resource names must be unique within a script.");
      this.resourceNames[name] = true;
    }
    // assert it's not there already
    if (this.dependencies.indexOf(dep)<0) {
      this.dependencies.push(dep);
      dep.module = this;
    }
  },

  addDependent: function(dep) {
    if (this.dependents.indexOf(dep)<0)
      this.dependents.push(dep);
  },

  removeDependent: function(dep) {
    var idx = this.dependents.indexOf(dep);
    if (idx>=0)
      this.dependents.splice(idx, 1);
  },

  removeBrokenDeps: function(runnable) {
    for (var i in this.dependents)
      this.dependents[i].removeBrokenDep(runnable);
  },

  resolveDep: function(parents, top) {
    if (!this.enabled)
      return false;
    // assert we're not our own parent (dodge infinite loops)
    if (parents) {
      if (parents.indexOf(this)>-1) {
        this.enabled = false;
        return false;
      }
    } else
      parents = [];
    // Move in front of the top node
    if (top) {
      var scripts = this.script._config._scripts;
      var tidx = scripts.indexOf(top.script);
      var idx = scripts.indexOf(this.script);
      if (tidx<idx) {
        scripts.splice(idx, 1);
        scripts.splice(tidx, 0, this.script);
        top = this;
      }
    } else
      top = this;
    // Move dependencies above us
    if (this.dependencies.length==0)
      return true;
    parents.push(this);
    var idx = parents.length;
    for (var i in this.dependencies) {
      var module = this.dependencies[i].dependency;
      if (module && module.resolveDep(parents, top))
        continue;
      this.enabled = false;
      break;
    }
    parents.splice(idx, 1);
    return this.enabled;
  },

  save: function(scriptNode, doc) {
    for (var d in this.dependencies) {
      scriptNode.appendChild(doc.createTextNode("\n\t\t"));
      scriptNode.appendChild(this.dependencies[d].save(doc));
    }
  }
}

/*
 * Script dependency
 */
function ScriptDependency() {
  this.module = null;
  this.dependency = null;
  this.resourceName = null;
  this._name = null;
  this._namespace = null;
  this._downloadURL = null;
}

ScriptDependency.prototype = {
  init: function(config) {
    if (this.dependency)
      return this.dependency;
    var script = config._find(this);
    if (!script)
      return null;
    // Link with dependency
    var module = script._module;
    this.dependency = module;
    // Complete missing info
    if (this._name && this._namespace)
      return module;
    this._name = script._name;
    this._namespace = script._namespace;
    return module;
  },

  clear: function() {
    this.dependency = null;
  },

  removeBrokenDep: function(runnable) {
    var idx = runnable.indexOf(this.module.script);
    if (idx<0)
      return;
    runnable.splice(idx, 1);
    this.module.removeBrokenDeps(runnable);
  },

  load: function(node) {
    this.resourceName = node.getAttribute("resourceName");
    this._name = node.getAttribute("name");
    this._namespace = node.getAttribute("namespace");
    this._downloadURL = node.getAttribute("downloadURL");
  },

  save: function(doc) {
    var node = doc.createElement("Depend");
    if (this.resourceName)
      node.setAttribute("resourceName", this.resourceName);
    if (this._name && this._namespace) {
      node.setAttribute("name", this._name);
      node.setAttribute("namespace", this._namespace);
      return node;
    }
    node.setAttribute("downloadURL", this._downloadURL);
    return node;
  },

  parse: function(str, io, uri) {
    var res = str.match(/(\S+)(\s+(\S+))?/);
    // resourceName is optional
    if (res.length==4) {
      this.resourceName = res[1];
      this._downloadURL = io.newURI(res[3], null, uri).spec;
      return;
    }
    this._downloadURL = io.newURI(res[1], null, uri).spec;
  }
};

