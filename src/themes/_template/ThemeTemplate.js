/*

  This file defines the theming options and default values of detektIIIF

*/
import React from 'react'

class ThemeTemplate {

  // Title
  title = "detektIIIF"
  about = <span>About DetektIIIF.</span>

  // Options
  optionsDescription= <p>This is the DetektIIIF Options page.</p>

  optionsSwitches = {
    viewManifestUrls: true,
    viewManifestInfo: false
  }

  optionsLists = {
    openManifestLinks: true,
    openCollectionLinks: true,
    excludeWebsites: true
  }

  optionsLogoImage = null
  optionsSecondaryLogoImage = null

  optionsPunchline = <span>Options</span>

  workspaceName = "Workspace"

  // Images
  workspaceImage = null
  removeAllWorkspaceImage = null
  closeWorkspaceImage = null
  greenDotImage = null
  infoImage = null
  logoImage = null
  logoImageBig = null
  logoSecondaryImageBig = null
  redDotImage = null
  trashcanImage= null

  texts = {
    manifestInfoIcon: "This is a manifest."
  }

  // List Items

  generalButtons = {
    copyURL: true,
    addToWorkspace: true,
    removeFromWorkspace: true,
    downloadFullImage: true // only for images
  }

  qualityChips = {
    cors: true,
    https: true,
    urlid: true,
    hideok: true,
    combined: false
  }

  openManifestLinks = {
    uv: {
      url: 'https://uv-v4.netlify.app/#?manifest=%%%URI%%%',
      tabWorkspaces: false,
      tabManifests: true,
      backgroundColor: "#5e724d",
      label: {
        en: "Open in UV",
        de: "In UV öffnen"
      }
    },
    tify: {
      url: 'https://demo.tify.rocks/demo.html?manifest=%%%URI%%%',
      tabWorkspaces: false,
      tabManifests: true,
      backgroundColor: "#5e724d",
      label: {
        en: "Open in TIFY",
        de: "In TIFY öffnen"
      }
    },
    manducus: {
      url: 'https://manducus.net/m3?manifest=%%%URI%%%',
      tabWorkspaces: false,
      tabManifests: true,
      backgroundColor: "#5e724d",
      label: {
        en: "Open in M3",
        de: "In M3 öffnen"
      }
    }
  }

  // Workspaces

  postWorkspaceCollectionTo = {
    manducus: {
      url: 'https://manducus.net/m3/index.php',
      mode: 'x-www-form-urlencoded', // or json
      variable: 'collection', // for x-www-form-urlencoded only
      tabWorkspaces: true,
      tabCollections: true,
      tooltip: "Open your workspace collection in Mirador.",
      options: {
        hidden: false
      },
      label: {
        en: "Open Workspace in M3",
        de: "Workspace in M3 öffnen"
      }
    }

  }

}

export default ThemeTemplate
