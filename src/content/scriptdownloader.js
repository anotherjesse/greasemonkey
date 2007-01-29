/*
=== START LICENSE ===

Copyright 2004-2005 Aaron Boodman

Contributors:
Jeremy Dunck, Nikolas Coukouma, Matthew Gray.

Permission is hereby granted, free of charge, to any person obtaining a copy 
of this software and associated documentation files (the "Software"), to deal 
in the Software without restriction, including without limitation the rights 
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell 
copies of the Software, and to permit persons to whom the Software is 
furnished to do so, subject to the following conditions:

Note that this license applies only to the Greasemonkey extension source 
files, not to the user scripts which it runs. User scripts are licensed 
separately by their authors.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE 
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, 
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE 
SOFTWARE.

=== END LICENSE ===

The above copyright notice and this permission notice shall be included in all 
copies or substantial portions of the Software.
*/

function ScriptDownloader() {}

ScriptDownloader.prototype.installFromURL = function(url) {
  GM_BrowserUI.showStatus("Downloading user script...");

  this.xhr = new XMLHttpRequest();
  this.url = url;

  try {
    this.xhr.open("GET", url);
    this.xhr.onload = GM_hitch(this, "installFromURLSuccess");
    this.xhr.onerror = GM_hitch(this, "installFromURLFailure");
    this.xhr.send(null);
  }
  catch (e) {
    handleErrors(e);
  }
}

ScriptDownloader.prototype.installFromURLFailure = function(e) {
  alert("Could not download user script\n\n" + e.toString());
  GM_BrowserUI.hideStatus();
}
  
ScriptDownloader.prototype.installFromURLSuccess = function() {
  this.installFromSource(this.xhr.responseText, this.url);
}

ScriptDownloader.prototype.installFromSource = function(source, url) {
  var ioservice = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService();
  var sourceUri = ioservice.newURI(url, null, null);

  try {
    var targetFile = getTempFile();
    var writeStream = getWriteStream(targetFile);

    writeStream.write(source, source.length);
    writeStream.close();

    // initialize a new script object
    var script = new Script();
    script.filename = targetFile.leafName;
    script.enabled = true;
    script.includes = [];
    script.excludes = [];
    
    // read one line at a time looking for start meta delimiter or EOF
    var lines = source.match(/.+/g);
    var lnIdx = 0;
    var result = {};
    var foundMeta = false;

    while (result = lines[lnIdx++]) {
      if (result.indexOf("// ==UserScript==") == 0) {
        GM_log("* found metadata");
        foundMeta = true;
        break;
      }
    }

    // gather up meta lines
    if (foundMeta) {
      while (result = lines[lnIdx++]) {
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
          }
        }
      }
    }

    // if no meta info, default to reasonable values
    if (script.name == null) {
      script.name = parseScriptName(sourceUri);
    }

    if (script.namespace == null) {
      script.namespace = sourceUri.host;
    }

    if (script.includes.length == 0) {
      script.includes.push("*");
    }

    var config = new Config(getScriptFile("config.xml"));

    config.load();

    var newDir = getScriptDir();
    var existingIndex = config.find(script.namespace, script.name);
    var existingFile = null;
    var oldScripts = new Array(config.scripts);

    if (existingIndex > -1) {
      existingFile = getScriptFile(config.scripts[existingIndex].filename);
      existingFile.remove(false);
      config.scripts.splice(existingIndex, 1);
    }

    try {
      config.initFilename(script);
      targetFile.moveTo(newDir, script.filename)
      config.scripts.push(script);
      config.save();
      GM_BrowserUI.showStatus(script.filename + " installed successfully.", true);
    }
    catch (e) {
      config.scripts = oldScripts;
      throw e;
    }
  } catch (e2) {
    alert("Error installing user script:\n\n" + (e2 ? e2 : ""));
    GM_BrowserUI.hideStatus();
  }
}