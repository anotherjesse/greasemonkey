

function GM_ScriptStorage(script) {
  this.prefMan = new GM_PrefManager(["scriptvals.",
                                     script.namespace,
                                     "/",
                                     script.name,
                                     "."].join(""));
}

GM_ScriptStorage.prototype.setValue = function(name, val) {
  this.prefMan.setValue(name, val);
}

GM_ScriptStorage.prototype.getValue = function(name, defVal) {
  return this.prefMan.getValue(name, defVal);
}

function GM_Imports(script){
    this.script = script;
}

GM_Imports.prototype.getImport = function(name){
    var dep = false;
    var script = this.script;
    script.imports.forEach(function(d){
        if(d.name == name){
            dep = d;
        }
    });
    if(dep){
        var getDepContents = function(){
            return getContents(getDependencyFileURI(script, dep))
        }
        var getDepURI = function(){
            var ioService=Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);
 		    const appSvc = Components.classes["@mozilla.org/appshell/appShellService;1"].getService(Components.interfaces.nsIAppShellService);
 		    var window = appSvc.hiddenDOMWindow;
 		    var binaryContents = getBinaryContents(getDependencyFileURI(script, dep))
 		    return "data:"+dep.mimetype+";base64,"+window.encodeURIComponent(window.btoa(binaryContents));
        }
        return {getContents: getDepContents, getURI: getDepURI};
    }else{
        //TODO: Throw error
    }
}


function GM_ScriptLogger(script) {
  var namespace = script.namespace;
  
  if (namespace.substring(namespace.length - 1) != "/") {
    namespace += "/";
  }
  
  this.prefix = [namespace, script.name, ": "].join("");
}

GM_ScriptLogger.prototype.log = function(message) {
  GM_log(this.prefix + message, true);
}


// Based on Mark Pilgrim's GM_addGlobalStyle from 
// http://diveintogreasemonkey.org/patterns/add-css.html. Used by permission
// under GPL: http://diveintogreasemonkey.org/license/gpl.html
function GM_addStyle(doc, css) {
  var head, style;
  head = doc.getElementsByTagName('head')[0];
  if (!head) { return; }
  style = doc.createElement('style');
  style.type = 'text/css';
  style.innerHTML = css;
  head.appendChild(style);
}