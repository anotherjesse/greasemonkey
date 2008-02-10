/**
 * Checks whether the version has changed since the last run and performs
 * any necessary upgrades.
 */
Config.prototype.updateVersion = function()
{
  log("> GM_updateVersion");

  // this is the last version which has been run at least once
  var initialized = GM_prefRoot.getValue("version", "0.0");

  if (GM_compareVersions(initialized, "0.3") == -1) {
    this._pointThreeMigrate();
  }

  if (GM_compareVersions(initialized, "0.4.2") == -1) {
    this._pointFourMigrate();
  }

  if (GM_compareVersions(initialized, "0.8") == -1) {
    this._pointEightBackup();
  }

  // update the currently initialized version so we don't do this work again.
  var extMan = Components.classes["@mozilla.org/extensions/manager;1"]
    .getService(Components.interfaces.nsIExtensionManager);

  var item = extMan.getItemForID(GM_GUID);
  GM_prefRoot.setValue("version", item.version);

  log("< GM_updateVersion");
}

/**
 * In Greasemonkey 0.8 there was a format change to the gm_scripts folder and
 * testing found several bugs where the entire folder would get nuked. So we are
 * paranoid and backup the folder the first time 0.8 runs.
 */
Config.prototype._pointEightBackup = function()
{
  var scriptDir = this.newScriptDir;
  var scriptDirBackup = scriptDir.clone();
  scriptDirBackup.leafName += "_08bak";
  if (scriptDir.exists() && !scriptDirBackup.exists()) {
    scriptDir.copyTo(scriptDirBackup.parent, scriptDirBackup.leafName);
  }
}

/**
 * Copies the entire scripts directory to the new location, if it exists.
 */
Config.prototype._pointFourMigrate = function()
{
  log("> GM_pointFourMigrate");

  // Create a scripts dir if it does not exist
  this.scriptDir;

  log("< GM_pointFourMigrate");
}

/**
 * Migrates the configuration directory from the old format to the new one
 */
Config.prototype._pointThreeMigrate = function()
{
  log("> GM_pointThreeMigrate");

  // check to see whether there's any config to migrate
  var configFile = this.oldScriptDir;
  configFile.append("config.xml");
  var configExists = configFile.exists();

  log("config file exists: " + configExists);
  if (!configExists) {
    return;
  }

  // back up the config directory
  // if an error happens, report it and exit
  try {
    var scriptDir = this.oldScriptDir;
    var tempDir = getTempFile();

    log("script dir: " + scriptDir.path);
    log("temp dir: " + tempDir.path);

    scriptDir.copyTo(tempDir.parent, tempDir.leafName);

    // update the format of the config.xml file and move each file
    var script = null;
    var scriptFile = null;
    var doc = document.implementation.createDocument("", "", null);

    var configURI = Components.classes["@mozilla.org/network/io-service;1"]
                              .getService(Components.interfaces.nsIIOService)
                              .newFileURI(configFile);

    // first, load config.xml raw and add the new required filename attribute
    doc.async = false;
    doc.load(configURI.spec);

    log("loaded existing config...");

    var nodes = document.evaluate("/UserScriptConfig/Script", doc, null,
        XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null);
    var node;

    for (var i = 0; (node = nodes.snapshotItem(i)); i++) {
      if (node.hasAttribute("id")) {
        node.setAttribute("filename", node.getAttribute("id"));
      }
    }

    // save the config file
    var configStream = getWriteStream(configFile);
    new XMLSerializer().serializeToStream(doc, configStream, "utf-8");
    configStream.close();

    log("config saved.");

    // now, load config normally and reinitialize all scripts's filenames
    this.load();

    log("config reloaded, moving files.");

    for (var i = 0; (script = this.scripts[i]); i++) {
      if (script.filename.match(/^\d+$/)) {
        var scriptFile = this.oldScriptDir;
        scriptFile.append(script.filename);
        this.initFilename(script);
        log("renaming script " + scriptFile.leafName + " to " + script.filename);
        scriptFile.moveTo(scriptFile.parent, script.filename);
      }
    }

    log("moving complete. saving configuration.");

    // save the config file
    this.save();

    log("0.3 migration completed successfully!");
  } catch (e) {
    alert("Could not complete Greasemonkey 0.3 migration. Some changes may " +
          "have been made to your scripts directory. See JS Console for " +
          "error details.\n\nA backup of your old scripts directory is at: " +
          tempDir.path);
    throw e;
  } finally {
    log("< GM_pointThreeMigrate");
  }
}
