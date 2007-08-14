
function DownloadQueue(){
    var queue = [];
    var onFinish;
    var req;
    var thisObj = this;
    var onError;
    
    this.add = function(url, onload, onerror){
        queue.push({url : url, onload: onload, onerror: onerror});
    }
    
    this.start = function(handler, errorHandler){
       onFinish = handler;
       onError = errorHandler || function(){};
       downloadNext();
    }
    
    function downloadNext(){
        if(queue.length>0){
            var job = queue.pop();
            try{
                var persist = Components.classes["@mozilla.org/embedding/browser/nsWebBrowserPersist;1"].createInstance(Components.interfaces.nsIWebBrowserPersist);
                persist.persistFlags = persist.PERSIST_FLAGS_BYPASS_CACHE | persist.PERSIST_FLAGS_REPLACE_EXISTING_FILES; //doesn't work? 
				var progressListener = new PersistProgressListener(persist);
                var file = getTempFile();
                progressListener.onFinish =  GM_hitch(thisObj, "handleDownloadComplete", job, file);
                persist.progressListener = progressListener;
                var ioservice = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService();
	            var sourceUri = ioservice.newURI(job.url, null, null);
                var sourceChannel = ioservice.newChannelFromURI(sourceUri);
                sourceChannel.notificationCallbacks = new NotificationCallbacks(); 
                progressListener.onFinish =  GM_hitch(thisObj, "handleDownloadComplete", job, file, sourceChannel);
                persist.saveChannel(sourceChannel,  file);

            }catch(e){
                GM_log("Download exception " + e);
            }
        }else{
            onFinish();
        }
   
    }
    
   this.handleDownloadComplete = function(job, file, channel){
          GM_log("DQ: Download complete ");
          try{
              var httpChannel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);
          }catch(e){
              var httpChannel = false;    
          }
          
          if(httpChannel){
              if(httpChannel.requestSucceeded){
                  job.onload(file, channel.contentType);
                  downloadNext();
              }else{
                   if(job.onerror){
                       job.onerror(httpChannel.responseStatus + ": " + httpChannel.responseStatusText)
                   }              
              }
          }else{
              job.onload(file, channel.contentType);
              downloadNext();
          }
    }
}

function NotificationCallbacks(){
    
}

NotificationCallbacks.prototype = {
   QueryInterface : function(aIID)
   {
       if(aIID.equals(Components.interfaces.nsIInterfaceRequestor)){
           return this;
       }
       throw Components.results.NS_NOINTERFACE;
   },
   
   getInterface : function(aIID){
       if(aIID.equals(Components.interfaces.nsIAuthPrompt )){
         var winWat = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                          .getService(Components.interfaces.nsIWindowWatcher);
         return winWat.getNewAuthPrompter(winWat.activeWindow);                          
       }
   } 
};

function PersistProgressListener(persist){
	this.persist = persist;
    this.onFinish = function(){};
	this.persiststate = "";
};

PersistProgressListener.prototype =
 {
   QueryInterface : function(aIID)
   {
     if(aIID.equals(Components.interfaces.nsIWebProgressListener)){
       return this;
     }
     throw Components.results.NS_NOINTERFACE;
   },
   
 
   // nsIWebProgressListener
   onProgressChange : function (aWebProgress, aRequest,
                                aCurSelfProgress, aMaxSelfProgress,
                                aCurTotalProgress, aMaxTotalProgress)
   {
      GM_log("Persister.progress: "+ aCurTotalProgress + " of "+ aMaxTotalProgress);
   },
 
   onStateChange : function(aWebProgress, aRequest, aStateFlags, aStatus)
   {
     try {
       if(this.persist.currentState == this.persist.PERSIST_STATE_READY){
            
       }else if(this.persist.currentState == this.persist.PERSIST_STATE_SAVING){
           
       }else if(this.persist.currentState == this.persist.PERSIST_STATE_FINISHED){
          GM_log("Persister: Download complete " + aRequest.status);
	      this.onFinish();
       }
     }catch(e) {
       //  log("Exception " + e + " : " + e.fileName + " " + e.lineNumber);
     }
     
   },
 
   onLocationChange : function(aWebProgress, aRequest, aLocation)
   {
   },
 
   onStatusChange : function(aWebProgress, aRequest, aStatus, aMessage)
   {
     GM_log("Persister.onStatusChange: " + aMessage);
   },
 
   onSecurityChange : function(aWebProgress, aRequest, aState)
   {
   }
};