const GUID = "{e4a8a97b-f2ed-450b-b12d-ee082ba24781}";
const NAMESPACE = "http://youngpup.net/greasemonkey";

function Config() {
	this.onload = null;
	this.scripts = null;

	this.find = function(namespace, name) {
		namespace = namespace.toLowerCase();
		name = name.toLowerCase();

		for (var i = 0, script = null; (script = this.scripts[i]); i++) {
			if (script.namespace.toLowerCase() == namespace && script.name.toLowerCase() == name) {
				return i;
			}
		}

		return -1;
	}
	
	this.load = function() {
		var doc = document.implementation.createDocument("", "", null);
		doc.async = false;
		doc.load(getScriptChrome("config.xml"));

		var nodes = document.evaluate("/UserScriptConfig/Script", doc, null, 0, null);

		this.scripts = [];

		for (var node = null; (node = nodes.iterateNext()); ) {
			var script = new Script();

			for (var i = 0, childNode = null; (childNode = node.childNodes[i]); i++) {
				if (childNode.nodeName == "Include") {
					script.includes.push(childNode.firstChild.nodeValue);
				}
				else if (childNode.nodeName == "Exclude") {
					script.excludes.push(childNode.firstChild.nodeValue);
				}
			}

			script.id = node.getAttribute("id");
			script.name = node.getAttribute("name");
			script.namespace = node.getAttribute("namespace");
			script.description = node.getAttribute("description");
			script.enabled = node.getAttribute("enabled") == true.toString();

			this.scripts.push(script);
		}
	}

	this.save = function() {
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

			scriptNode.appendChild(doc.createTextNode("\n\t"));

			scriptNode.setAttribute("id", scriptObj.id);
			scriptNode.setAttribute("name", scriptObj.name);
			scriptNode.setAttribute("namespace", scriptObj.namespace);
			scriptNode.setAttribute("description", scriptObj.description);
			scriptNode.setAttribute("enabled", scriptObj.enabled);

			doc.firstChild.appendChild(doc.createTextNode("\n\t"));
			doc.firstChild.appendChild(scriptNode);
		}

		doc.firstChild.appendChild(doc.createTextNode("\n"))

		var configStream = getWriteStream("config.xml");
		new XMLSerializer().serializeToStream(doc, configStream, "utf-8");
		configStream.close();
	}
}

function Script() {
	this.name = null;
	this.namespace = null;
	this.description = null;
	this.enabled = true;
	this.includes = [];
	this.excludes = [];
}

function ScriptDownloader(url) {
	var dm = Components.classes["@mozilla.org/download-manager;1"].getService(Components.interfaces.nsIDownloadManager)
	var ioservice = Components.classes["@mozilla.org/network/io-service;1"].getService();
	var sourceUri = ioservice.newURI(url, null, null);
	var targetFile = getTempFile();
	var targetUri = ioservice.newFileURI(targetFile)
	var persist = makeWebBrowserPersist();	
	var sysListener = null;
	var download = null;
	var self = this;
	var timerId = null;

	this.start = function() {
		try {
			dm.addDownload(0, sourceUri, targetUri, parseScriptName(sourceUri), null, null, null, persist)
			dm.open(window._content, targetFile.path)

			download = dm.getDownload(targetFile.path);
			download.persist = persist;

			persist.saveURI(sourceUri, null, null, null, null, targetFile);

			// this seems like a huge hack, but it was actually the most reliable
			// way I could find to determine when downloading is complete
			timerId = window.setInterval(checkLoad, 200);
		}
		catch (e) {
			handleErrors(e);
		}
	}

	function checkLoad() {
		// if the download is complete, stop.
		if (download.percentComplete == 100) {
			window.clearInterval(timerId);
			handleLoad();
		}
		// if not complete yet, double-check that somebody hasn't cancelled it
		else if (dm.getDownload(targetFile.path) == null) {
			// the download is no longer active
			window.clearInterval(timerId);
			return;
		}
		// otherwise, do nothing. downloading continues.
	}

	function handleLoad() {
		closeDownloadManager();

		// validate that we downloaded ok
		if (!targetFile.exists() || targetFile.fileSize == 0) {
			alert("The file does not exist or was removed.");
			return;
		}

		// initialize a new script object
		var script = new Script();
		script.id = targetFile.leafName;
		script.enabled = true;
		script.includes = [];
		script.excludes = [];

		// crack open the file so we can look for metadata in the comments
		var fileStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
						.createInstance(Components.interfaces.nsIFileInputStream);

		fileStream.init(targetFile, 1, 0, false);

		// read one line at a time looking for start meta delimiter or EOF
		var lineStream = fileStream.QueryInterface(Components.interfaces.nsILineInputStream);
		var result = {};
		var foundMeta = false;

		while (lineStream.readLine(result)) {
			if (result.value.indexOf("// ==UserScript==") == 0) {
				foundMeta = true;
				break;
			}
		}

		// gather up meta lines
		if (foundMeta) {
			while (lineStream.readLine(result)) {
				if (result.value.indexOf("// ==/UserScript==") == 0) {
					break;
				}

				var match = result.value.match(/\/\/ \@(\S+)\s+([^\n]+)/);
				if (match != null) {
					switch (match[1]) {
						case "name":
						case "namespace":
						case "description":
							script[match[1]] = match[2];
							break;
						case "includes":
						case "excludes":
							script[match[1]].push(match[2]);
							break;
					}
				}
			}
		}

		fileStream.close();

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

		// open install dialog
		var result = {};
		window.openDialog("chrome://greasemonkey/content/install.xul", 
			"manager", "resizable,centerscreen,modal", script, targetFile, result);

		closeDownloadManager();

		if (result.value) {
			alert("Success! Refresh page to see changes.");
		}
	}

	function handleErrors(e) {
		//todo: need to handle this somehow. perhaps nsIUriChecker?
		//if (e.name == "NS_ERROR_FILE_NOT_FOUND") {
		//	alert("User script could not be found. Please check the name and try again.");
		//	window.status = defaultStatus;
		//}
		//else {
			alert("Could not download user script\n\n" + e.toString());
		//}
	}

	function closeDownloadManager() {
		var wm = Components.classes['@mozilla.org/appshell/window-mediator;1'].getService(Components.interfaces.nsIWindowMediator); 
		var en = wm.getEnumerator(""); 
		var n = 0; 
		var dlm = null;
		
		while (en.hasMoreElements()) { 
			var w = en.getNext(); 

			if (w.location.href == "chrome://mozapps/content/downloads/downloads.xul") {
				dlm = w;
				break;
			}
		}

		if (dlm != null) {
			dlm.close();
		}
	}
}

function parseScriptName(sourceUri) {
	var name = sourceUri.spec;
	name = name.substring(0, name.indexOf(".user.js"));
	name = name.substring(name.lastIndexOf("/") + 1);
	return name;
}

function getTempFile() {
	var file = Components.classes["@mozilla.org/file/directory_service;1"]
				.getService(Components.interfaces.nsIProperties)
				.get("TmpD", Components.interfaces.nsILocalFile);

	file.append(new Date().getTime());

	return file;
}

function getWriteStream(fileName) {
	var file = getScriptFile(fileName);
	var stream = Components.classes["@mozilla.org/network/file-output-stream;1"]
		.createInstance(Components.interfaces.nsIFileOutputStream);

	stream.init(file, 0x02 | 0x08 | 0x20, 420, 0);

	return stream;
}

function getScriptChrome(fileName) {
	return "chrome://greasemonkey/content/scripts/" + fileName;
}

function getScriptFile(fileName) {
	var file = getScriptDir();
	file.append(fileName);
	return file;
}

function getScriptDir() {
	var file = Components.classes["@mozilla.org/file/directory_service;1"]
				.getService(Components.interfaces.nsIProperties)
				.get("ProfD", Components.interfaces.nsILocalFile);

	file.append("extensions");
	file.append(GUID);
	file.append("chrome");
	file.append("greasemonkey");
	file.append("content");
	file.append("scripts");

	return file;
}

// Converts a pattern in this programs simple notation to a regular expression.
// thanks AdBlock! http://www.mozdev.org/source/browse/adblock/adblock/
function convert2RegExp( pattern ) {
	s = new String(pattern);
	res = new String("^");
	
	for (var i = 0 ; i < s.length ; i++) {
		switch(s[i]) {
			case '*' : 
				res += ".*";
				break;
				
			case '.' : 
			case '?' :
			case '^' : 
			case '$' : 
			case '+' :
			case '{' :
			case '[' : 
			case '|' :
			case '(' : 
			case ')' :
			case ']' :
				res += "\\" + s[i];
				break;
			
			case '\\' :
				res += "\\\\";
				break;
			
			case ' ' :
				// Remove spaces from URLs.
				break;
			
			default :			
				res += s[i];
				break;
		}
	}

	return new RegExp(res + '$', "i");
}

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
}