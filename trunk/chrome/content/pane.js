// Variables for convience
var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;
var Cr = Components.results;

var SB_NewDataRemote = Components.Constructor("@songbirdnest.com/Songbird/DataRemote;1",
                                              "sbIDataRemote",
                                              "init");

const MIN_REFRESH = 2000;         // Minimum of every 2 seconds
const NOTIFICATION_TIME = 5000;   // Remove after 5 seconds

// import the XPCOM helper
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://app/jsmodules/sbProperties.jsm");

// Make a namespace.
if (typeof Lastfmsidebar == 'undefined') {
  var Lastfmsidebar = {};
}

/**
 * Controller for pane.xul
 */
Lastfmsidebar.PaneController = {
  _lastFMService: null,         // Last FM service (From add on)
  _mediacoreManager: null,      // Media Core manager for track changes
  _browser: null,               // For loading links

  _notificationBox: null,       // The notification box for notifications
  _maxRecent: null,             // Number of recent tracks to show (dataremote)
  _refreshInterval: null,       // How often to refresh even without track changes
  _showImages: null,            // Should we show images for the entries?

  _refreshTimer: null,          // Refresh timer for song list
  _notificationTimer: null,     // Timer to remove notifications

  _curMediaItem: null,          // Currently playing media item

  /**
   * Called when the pane is instantiated
   */
  onLoad: function() {

    // get the XPCOM service as a JS object
    this._lastFMService = Cc['@songbirdnest.com/lastfm;1']
                            .getService().wrappedJSObject
    // listen to events from our Last.fm service
    this._lastFMService.listeners.add(this);

    // Setup some variables
    this._notificationBox = document.getElementById("lastFmNotification");
    this._maxRecent = SB_NewDataRemote("lastfmsidebar.maxrecent", null);
    this._maxRecent.bindObserver(this, false);
    this._refreshInterval = SB_NewDataRemote("lastfmsidebar.refreshrate", null);
    this._refreshInterval.bindObserver(this, false);
    this._showImages = SB_NewDataRemote("lastfmsidebar.showimages", null);
    this._showImages.bindObserver(this, false);
    
    if (this._refreshInterval.intValue < MIN_REFRESH) {
      this._refreshInterval.intValue = MIN_REFRESH;
    }

    // Display what is appropriate now.
    this.onLoggedInStateChanged();

    // Load the mediacoreManager so we can monitor track changes.
    this._mediacoreManager = Cc["@songbirdnest.com/Songbird/Mediacore/Manager;1"]
                               .getService(Ci.sbIMediacoreManager);
    this._mediacoreManager.addListener(this);
  
    if (this._mediacoreManager.status != Ci.sbIMediacoreStatus.STATUS_STOPPED) {
      this._curMediaItem = this._mediacoreManager.sequencer.currentItem;
    }

    this._notificationTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    this._refreshTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    this._refreshTimer.init(this,
                            this._refreshInterval.intValue,
                            Ci.nsITimer.TYPE_REPEATING_SLACK);
  },
  
  /**
   * Called when the pane is about to close
   */
  onUnLoad: function() {
    this._mediacoreManager.removeListener(this);
    this._mediacoreManager = null;
  },

  /**
   * \brief getMainBrowser - This function gets the main browser.
   */
  getMainBrowser: function () {
    if (!this._browser) {
      // Get the main window, we have to do this because we are in a display pane
      // and our window is the content of the display pane.
      var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                            .getService(Components.interfaces.nsIWindowMediator);
  
      var songbirdWindow = windowMediator.getMostRecentWindow("Songbird:Main"); 
      // Store this so we don't have to get it every time.
      this._browser = songbirdWindow.gBrowser;
    }
    
    return this._browser;
  },

  // load an URL from an event in the panel
  loadURI: function(uri, event) {
    this.getMainBrowser().loadURI(uri, null, null, event, '_blank');
  },

  loadLink: function(aNodeType, aNode, event) {
    var lastFMUrl = "http://www.lastfm.com/music/";
    switch(aNodeType) {
      case 'albumImage':
      case 'trackName':
        var artistName = aNode.getAttribute("artistName");
        var trackName = aNode.getAttribute("trackName");
        lastFMUrl += encodeURIComponent(artistName) + "/_/";
        lastFMUrl += encodeURIComponent(trackName);
      break;
    
      case 'artistName':
        var artistName = aNode.getAttribute("artistName");
        lastFMUrl += encodeURIComponent(artistName);
      break;
    
      default:
        return;
      break;
    }
    
    this.loadURI(lastFMUrl, event);
    event.stopPropagation();
  },

  Refresh: function() {
    this.getUserRecentTracks();
  },

  formatPlayTime: function(aPlayTime) {
    var playTime = "listening now";
    if (aPlayTime == 0) {
      return playTime;
    }

    var nowTime = Math.round(new Date().getTime()  / 1000);
    var lapseTime = (nowTime - aPlayTime);

    var DAY_SECONDS = 86400;
    var HOUR_SECONDS = 3600;
    var MIN_SECONDS = 60;

    var days = hours = minutes = 0;
    
    var yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday = Math.round(yesterday.getTime() / 1000);
    
    if (lapseTime > DAY_SECONDS) {
      lapseTime -= (lapseTime * DAY_SECONDS);
    }

    if (lapseTime > HOUR_SECONDS) {
      hours = Math.round(lapseTime / HOUR_SECONDS);
      lapseTime -= (lapseTime * HOUR_SECONDS);
    }

    if (lapseTime > MIN_SECONDS) {
      minutes = Math.round(lapseTime / MIN_SECONDS);
      lapseTime -= (lapseTime * MIN_SECONDS);
    }

    seconds = (lapseTime > 0 ? lapseTime : 0);
  
    if (aPlayTime > yesterday) {
      // Must be today
      if (hours > 0) {
        playTime = hours + " hr ago";
      } else if (minutes > 0) {
        playTime = minutes + " min ago";
      } else {
        playTime = seconds + " sec ago";
      }
    } else if (aPlayTime > (yesterday - DAY_SECONDS)) {
      // Yesterday some time
      playTime = "Yest";
      // We need the time
      var formatDate = new Date();
      formatDate.setTime(aPlayTime * 1000);
      hours = formatDate.getHours();
      playTime += " " + (hours > 12 ? (hours - 12) : hours);
      minutes = formatDate.getMinutes();
      playTime += ":" + (minutes < 10 ? "0" + minutes : minutes);
      playTime += (hours > 12 ? "pm" : "am");
    } else {
      // Further back so just format the date
      // dd Mmm h:mm[a|p]m
      var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" ];
      var formatDate = new Date();
      formatDate.setTime(aPlayTime * 1000);
      playTime = formatDate.getDate();
      playTime += " " + months[parseInt(formatDate.getMonth())];
      hours = formatDate.getHours();
      playTime += " " + (hours > 12 ? (hours - 12) : hours);
      minutes = formatDate.getMinutes();
      playTime += ":" + (minutes < 10 ? "0" + minutes : minutes);
      playTime += (hours > 12 ? "pm" : "am");
    }
    return playTime;
  },

  _addTrackInfo: function(aTrackName, aArtistName, aAlbumName, aAlbumImage, aPlayTime, isFirst) {
    var listBox = document.getElementById('trackList');
    var listitem = document.createElement("richlistitem");
    var trackInfo = document.createElement("trackinfo");
    trackInfo.setAttribute("class", "trackinfo");
    trackInfo.setAttribute("hidePlaying", (aPlayTime != 0));
    trackInfo.setAttribute("trackName", aTrackName);
    trackInfo.setAttribute("artistName", aArtistName);
    trackInfo.setAttribute("albumName", aAlbumName);
    trackInfo.setAttribute("albumImage", aAlbumImage);
    trackInfo.setAttribute("albumHide", this._showImages.boolValue);
    trackInfo.setAttribute("playTime", this.formatPlayTime(aPlayTime));

    listitem.appendChild(trackInfo);

    if (isFirst && listBox.firstChild) {
      listBox.insertBefore(listitem, listBox.firstChild);
    } else {
      listBox.appendChild(listitem);
    }
  },

  _addCurrentTrack: function() {
    if (this._currMediaItem) {
      var curTrackName = this._currMediaItem.getProperty(SBProperties.trackName);
      var curArtistName = this._currMediaItem.getProperty(SBProperties.artistName);
      var curAlbumName = this._currMediaItem.getProperty(SBProperties.albumName);
      var curAlbumImage = this._currMediaItem.getProperty(SBProperties.primaryImageURL);
      this._addTrackInfo(curTrackName, curArtistName, curAlbumName, curAlbumImage, 0, true);
    }
  },

  _getNodeText: function(aNode, aTag, aAttrib, aAttribValue) {
    var tags = aNode.getElementsByTagName(aTag);
    if (tags.length) {
      var output = tags[0].textContent;
      if (aAttrib) {
        output = '';
        for (var tagIndex = 0; tagIndex < tags.length; tagIndex++) {
          if (tags[tagIndex].getAttribute(aAttrib) == aAttribValue) {
            output = tags[tagIndex].textContent;
            break;
          }
        }
      }
      return output;
    } else {
      return '';
    }
  },

  _getNodeAttrib: function(aNode, aTag, aAttrib) {
    var tags = aNode.getElementsByTagName(aTag);
    if (tags.length) {
      return tags[0].getAttribute(aAttrib);
    } else {
      return '';
    }
  },

  getUserRecentTracks: function() {
    var refreshButton = document.getElementById("toolbar-refresh");
    var busyIcon = document.getElementById("toolbar-busy");
    refreshButton.disabled = true;
    busyIcon.hidden = false;

    // get a lastfm mobile session
    var self = this;
    var trackLimit = this._maxRecent.intValue;
    this._lastFMService.apiCall('user.getrecenttracks', {
      user: encodeURIComponent(this._lastFMService.username),
      limit: trackLimit
    }, function response(success, xml) {
      if (success) 
        self.userTracks(xml);
      refreshButton.disabled = false;
      busyIcon.hidden = true;
    });
  },
  
  userTracks: function(xml) {
    var tracks = xml.getElementsByTagName('track');

    // Quickly clear the list
    var listBox = document.getElementById('trackList');
    while (listBox.lastChild) {
      listBox.removeChild(listBox.lastChild);
    }

    if (tracks.length == 0) {      
      var listitem = document.createElement("richlistitem");
      var trackLabel = document.createElement("label");
      trackLabel.value = "No tracks scrobbled yet!";
      listitem.appendChild(trackLabel);
      listBox.appendChild(listitem);
    } else {
      this._addCurrentTrack();

      for (var trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
        // Add each track to the listbox
        if (!tracks[trackIndex].hasAttribute("nowplaying")) {
          var trackName = this._getNodeText(tracks[trackIndex], 'name');
          var artistName = this._getNodeText(tracks[trackIndex], 'artist');
          var albumName = this._getNodeText(tracks[trackIndex], 'album');
          var albumImage = this._getNodeText(tracks[trackIndex], 'image', 'size', 'small');
          if (!albumImage || albumImage == "") {
            albumImage = "chrome://songbird/skin/album-art/default-cover.png";
          }
          var utcPlayTime = parseInt(this._getNodeAttrib(tracks[trackIndex], 'date', 'uts'));
          this._addTrackInfo(trackName, artistName, albumName, albumImage, utcPlayTime);
        }
      }
    }
  },

  fireNotification: function (aMessage, aPriority) {
    this._notificationBox.appendNotification(aMessage,
        null,
        null,
        aPriority,
        null);

    this._notificationTimer.cancel();
    this._notificationTimer.init(this,
                                 NOTIFICATION_TIME,
                                 Ci.nsITimer.TYPE_ONE_SHOT);
  },

  /**
   * Last Fm Service Listener functions
   */
  onLoginBegins: function() {
  },
  onLoginFailed: function() {
  },
  onLoginCancelled: function() {
  },
  onLoginSucceeded: function() {
    this._notificationBox.removeAllNotifications(true);
    this.getUserRecentTracks();
  },
  onProfileUpdated: function() {
  },
  onShouldScrobbleChanged: function(shouldScrobble) {
  },
  onUserLoggedOutChanged: function(isLoggedOut) {
  },
  onErrorChanged: function(aError) {
    if (aError) {
      this.fireNotification(aError,
                            this._notificationBox.PRIORITY_CRITICAL_HIGH);
    }
  },
  onLoggedInStateChanged: function() {
    if (this._lastFMService.loggedIn) {
      // logged in
    } else {
      // logged out
    }
  },
  onLoveBan: function() {
  },

  /*********************************
   * sbIMediacoreEventListener and Event Handlers
   ********************************/
  onMediacoreEvent: function AlbumArt_onMediacoreEvent(aEvent) {
    switch(aEvent.type) {
      case Ci.sbIMediacoreEvent.STREAM_STOP:
        // Since we are no longer listening to anything clear the first entry
        var listBox = document.getElementById('trackList');
        listBox.removeChild(listBox.firstChild);

        // Now requery so that we can fill the box properly.
        this._currMediaItem = null;
        this.getUserRecentTracks();
      break;
      case Ci.sbIMediacoreEvent.TRACK_CHANGE:
        if (this._currMediaItem) {
          // Since we are changing tracks, remove the first entry and add the new one
          var listBox = document.getElementById('trackList');
          listBox.removeChild(listBox.firstChild);
        }

        // Add the current item right away since the query may take a while.
        this._currMediaItem = aEvent.data;
        this._addCurrentTrack();

        // Now run the query to update the results
        this.getUserRecentTracks();
      break;
    }
  },

  /********************************
   * sbIObserver
   *******************************/
  observe: function (subject, topic, data) {
    if (topic == 'timer-callback') {
      if (subject == this._refreshTimer) {
        this.getUserRecentTracks();
      } else {
        // Remove any existing notifications
        this._notificationBox.removeCurrentNotification();
        if (this._notificationBox.currentNotification) {
          // Reset the timer to get rid of the next one
          this._notificationTimer.init(this,
                                       NOTIFICATION_TIME,
                                       Ci.nsITimer.TIMER_ONE_SHOT);
        }
      }
    } else if (topic == 'lastfmsidebar.maxrecent') {
      this.getUserRecentTracks();
    } else if (topic == 'lastfmsidbar.refreshrate') {
      if (this._refreshInterval.intValue < MIN_REFRESH) {
        this._refreshInterval.intValue = MIN_REFRESH;
        return;
      }

      this._refreshTimer.cancel();
      this._refreshTimer.init(this,
                              this._refreshInterval.intValue,
                              Ci.nsITimer.TYPE_REPEATING_SLACK);
    } else if (topic == 'lastfmsidebar.showimages') {
      this.getUserRecentTracks();
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.sbIMediacoreEventListener,
                                         Ci.nsIObserver])  
};

window.addEventListener("load", function(e) { Lastfmsidebar.PaneController.onLoad(e); }, false);
window.addEventListener("unload", function(e) { Lastfmsidebar.PaneController.onUnLoad(e); }, false);

