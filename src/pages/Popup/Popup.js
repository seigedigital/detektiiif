/*global chrome*/
import React, { Component } from 'react'

import Theme from '../../themes/active/Theme.js'
import Defaults from '../../themes/active/Defaults.js'

import {getCurrentTab} from "./common/Utils"
import DisplayCollection from "./components/DisplayCollection"
import DisplayManifest from "./components/DisplayManifest"
import DisplayImage from "./components/DisplayImage"
import DisplayWorkspace from "./components/DisplayWorkspace"
import PostButton from "./components/PostButton"
import {
  DEFAULT_WORKSPACE_ID,
  addItemToWorkspace,
  addWorkspace,
  deleteWorkspace,
  getActiveWorkspace,
  loadWorkspaceState,
  removeItemFromWorkspace,
  renameWorkspace,
  saveWorkspaceItems,
  setActiveWorkspace,
} from "../../shared/workspaces"
import { normalizeWorkspaceLinks } from "../../shared/viewerLinks"

import PropTypes from 'prop-types';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

import IconButton from '@mui/material/IconButton';
import WorkspacesOutlinedIcon from '@mui/icons-material/WorkspacesOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import Badge from '@mui/material/Badge';
import Tooltip from '@mui/material/Tooltip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

import Snackbar from '@mui/material/Snackbar';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';

import packageJson from '../../../package.json'

import { v4 } from 'uuid'
import { v5 } from 'uuid'

function TabPanel(props) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

TabPanel.propTypes = {
  children: PropTypes.node,
  index: PropTypes.number.isRequired,
  value: PropTypes.number.isRequired,
};

function a11yProps(index) {
  return {
    id: `simple-tab-${index}`,
    'aria-controls': `simple-tabpanel-${index}`,
  };
}

class Popup extends Component {
    constructor(props) {
        super(props)
        this.theme = new Theme()
        this.defaults = new Defaults()
        this.state = {
            manifests: {},
            collections: {},
            images: {},
            workspaces: {},
            activeWorkspaceId: DEFAULT_WORKSPACE_ID,
            settings: {
              showUrl: true,
              postWorkspaceCollectionTo: normalizeWorkspaceLinks(this.theme.postWorkspaceCollectionTo || this.theme.postBasketCollectionTo),
              openManifestLinks: normalizeWorkspaceLinks(this.theme.openManifestLinks),
              viewManifestInfo: Object.assign({},this.theme.viewManifestInfo)
            },
            tab: 0, // 0=Manifests 1=Images 2=Collections 3=Workspaces 4=About
            remDialog: false,
            remKey: null,
            snackOpen: false,
            snackMsg: ''
        }
        this.copyWorkspaceCollection = this.copyWorkspaceCollection.bind(this)
        this.closeRemDialog = this.closeRemDialog.bind(this)
        this.openRemDialog = this.openRemDialog.bind(this)
        this.removeOperation = this.removeOperation.bind(this)
        this.getDataFromLocalStorage = this.getDataFromLocalStorage.bind(this)
        this.openLocalMirador = this.openLocalMirador.bind(this)
        this.loadWorkspaces = this.loadWorkspaces.bind(this)
        this.addToWorkspace = this.addToWorkspace.bind(this)
        this.createWorkspace = this.createWorkspace.bind(this)
        this.renameActiveWorkspace = this.renameActiveWorkspace.bind(this)
        this.deleteActiveWorkspace = this.deleteActiveWorkspace.bind(this)
        this.setActiveWorkspace = this.setActiveWorkspace.bind(this)
        // this.routine = this.routine.bind(this)

        this.loadWorkspaces()

        chrome.storage.onChanged.addListener( (changes, namespace) => {
          for (let [key, { oldValue, newValue }] of Object.entries(changes)) {

            if(namespace==="local" &&  key==="showUrl") {
              this.setState({settings:Object.assign({},this.state.settings,{showUrl:newValue})})
            }

            if(namespace==="local" &&  key==="postWorkspaceCollectionTo") {
              this.setState({settings:Object.assign({},this.state.settings,{postWorkspaceCollectionTo:normalizeWorkspaceLinks(newValue)})})
            }

            if(namespace==="local" &&  key==="openManifestLinks") {
              this.setState({settings:Object.assign({},this.state.settings,{openManifestLinks:normalizeWorkspaceLinks(newValue)})})
            }

            if(namespace==="sync" && (key==="workspaces" || key==="activeWorkspaceId")) {
              this.loadWorkspaces()
            }

            // console.log(
            //   `Storage key "${key}" in namespace "${namespace}" changed.`,
            //   `Old value was "${oldValue}", new value is "${newValue}".`
            // )
          }
        });
    }

    getDataFromLocalStorage() {
        getCurrentTab((tab) => {
            chrome.storage.local.get(['tabStorage'], (result) => {
              console.log({FEresult:result})
              if('tabStorage' in result) {
                let tabStorage = JSON.parse(result['tabStorage'])
                if(tabStorage[tab.id] !== undefined) {
                  console.log("OK "+tab.id)
                  this.setState(Object.assign({},tabStorage[tab.id]['iiif']), () => {
                    console.log({TS:this.state})
                  })
                }
              } else {
                console.log("NOT OK1 "+tab.id)
                this.setState({manifests:{},collections:{},images:{}})
              }
            })
        })
    }

    // routine() {
    //   this.getDataFromLocalStorage()
    //   setTimeout(this.routine,1000)
    // }

    componentDidMount() {
        // getCurrentTab((tab) => {
        //
        //     chrome.storage.local.get(['tabStorage'], (result) => {
        //       console.log({FEresult:result})
        //       if('tabStorage' in result) {
        //         let tabStorage = JSON.parse(result['tabStorage'])
        //         if(tabStorage[tab.id] !== undefined) {
        //           console.log("OK "+tab.id)
        //           this.setState(Object.assign({},tabStorage[tab.id]['iiif']), () => {
        //             console.log({TS:this.state})
        //           })
        //         }
        //       } else {
        //         console.log("NOT OK1 "+tab.id)
        //         this.setState({manifests:{},collections:{},images:{}})
        //       }
        //     })
        //
        //     // chrome.runtime.sendMessage({type: 'popupInit', tabId: tab.id, url: tab.url}, (response) => {
        //     //     if (response) {
        //     //         this.setState(Object.assign({},{...response.iiif}))
        //     //     }
        //     // })
        // })
        this.getDataFromLocalStorage()
        this.loadWorkspaces()
        this.loadSettings()

        if(Object.keys(this.state.manifests).length>0) {
          this.setState({tab:0})
        } else if(Object.keys(this.state.images).length>0) {
          this.setState({tab:1})
        } else if(Object.keys(this.state.collections).length>0) {
          this.setState({tab:2})
        } else if(Object.keys(this.getCurrentWorkspaceItems()).length>0) {
          this.setState({tab:3})
        } else {
          this.setState({tab:0})
        }
    }

    copyUrl(url) {
      navigator.clipboard.writeText(url).then( () => {
        this.setState({
          snackOpen:true,
          snackMsg:'URL was copied to clipboard.'

        })
      }, () => {
        this.setState({
          snackOpen:true,
          snackMsg:'Failed to copy URL to clipboard.'
        })
      })
    }

    loadSettings() {
        chrome.storage.local.get(['postWorkspaceCollectionTo', 'postBasketCollectionTo'], (data) => {
          const storedLinks = data.postWorkspaceCollectionTo || data.postBasketCollectionTo
          if(storedLinks) {
            this.setState({
              settings:Object.assign({},this.state.settings,{
                postWorkspaceCollectionTo: normalizeWorkspaceLinks(storedLinks)
              })
            })
          }
        })
        chrome.storage.local.get('openManifestLinks', (data) => {
          console.log({LocSetM:data})
          if('openManifestLinks' in data) {
            this.setState({settings:Object.assign({},this.state.settings,{
              openManifestLinks: normalizeWorkspaceLinks(data.openManifestLinks)
            })})
          }
        })
        chrome.storage.local.get('showUrl', (data) => {
          console.log({LocSetS:data})
          if('showUrl' in data) { this.setState({settings:Object.assign({},this.state.settings,data)}) }
        })
    }

    openLocalMirador() {
      chrome.tabs.create({'url': `miradorpage.html?workspace=${encodeURIComponent(this.state.activeWorkspaceId)}`})
    }

    handleWorkspaceError(error) {
      console.error(error)
      this.setState({
        snackOpen: true,
        snackMsg: `Workspace could not be saved: ${error.message || error}`,
      })
    }

    getCurrentWorkspace() {
      return getActiveWorkspace(this.state.workspaces, this.state.activeWorkspaceId)
    }

    getCurrentWorkspaceItems() {
      return this.getCurrentWorkspace().items || {}
    }

    async loadWorkspaces() {
      try {
        const workspaceState = await loadWorkspaceState()
        this.setState(workspaceState)
      } catch (error) {
        this.handleWorkspaceError(error)
      }
    }

    async setActiveWorkspace(eventOrId) {
      try {
        const workspaceId = eventOrId && eventOrId.target ? eventOrId.target.value : eventOrId
        const workspaceState = await setActiveWorkspace(workspaceId)
        this.setState(workspaceState)
      } catch (error) {
        this.handleWorkspaceError(error)
      }
    }

    async createWorkspace() {
      const name = window.prompt('Workspace name')
      if (!name) {
        return
      }

      try {
        const workspaceState = await addWorkspace(name)
        this.setState(workspaceState)
      } catch (error) {
        this.handleWorkspaceError(error)
      }
    }

    async renameActiveWorkspace() {
      const workspace = this.getCurrentWorkspace()
      const name = window.prompt('Workspace name', workspace.name)
      if (!name) {
        return
      }

      try {
        const workspaceState = await renameWorkspace(workspace.id, name)
        this.setState(workspaceState)
      } catch (error) {
        this.handleWorkspaceError(error)
      }
    }

    async deleteActiveWorkspace() {
      const workspace = this.getCurrentWorkspace()
      if (workspace.id === DEFAULT_WORKSPACE_ID) {
        return
      }

      if (!window.confirm(`Delete workspace "${workspace.name}"?`)) {
        return
      }

      try {
        const workspaceState = await deleteWorkspace(workspace.id)
        this.setState(workspaceState)
      } catch (error) {
        this.handleWorkspaceError(error)
      }
    }

    async addToWorkspace(key) {
      const manifest = this.state.manifests[key]
      if (!manifest) {
        return
      }

      try {
        const workspaceState = await addItemToWorkspace(
          this.state.activeWorkspaceId,
          key,
          manifest
        )
        this.setState(workspaceState)
      } catch (error) {
        this.handleWorkspaceError(error)
      }
    }

    openRemDialog(key) {
      this.setState({remDialog:true,remKey:key})
    }

    closeRemDialog(key) {
      this.setState({remDialog:false,remKey:null})
    }

    async removeOperation() {
      try {
        let workspaceState
        if(this.state.remKey!==null) {
          workspaceState = await removeItemFromWorkspace(
            this.state.activeWorkspaceId,
            this.state.remKey
          )
        } else {
          workspaceState = await saveWorkspaceItems(this.state.activeWorkspaceId, {})
        }
        this.setState(workspaceState)
        this.closeRemDialog()
      } catch (error) {
        this.handleWorkspaceError(error)
      }
    }

    buildWorkspaceCollection(workspaceItems, workspace = this.getCurrentWorkspace()) {
      var c = {
            "@context": "http://iiif.io/api/presentation/2/context.json",
            "@id": `https://detektiiif.net/workspaces/${workspace.id}`,
            "@type": "sc:Collection",
            "label": `${workspace.name} Workspace`,
            "manifests": []
      }
      for (var key in workspaceItems) {
        c.manifests.push({
            "@id": workspaceItems[key].url,
            "@type": "sc:Manifest",
            "label": workspaceItems[key].label,
            "thumbnail": workspaceItems[key].thumb
        })
      }
      return c
    }

    copyWorkspaceCollection() {
      var c = this.buildWorkspaceCollection(this.getCurrentWorkspaceItems())
      navigator.clipboard.writeText(JSON.stringify(c)).then( () => {
        this.setState({
          snackOpen:true,
          snackMsg:'JSON was copied to clipboard.'

        })
      }, () => {
        this.setState({
          snackOpen:true,
          snackMsg:'Failed to copy JSON to clipboard.'

        })
      })
    }

    render() {

        console.log({renderWithState:this.state})

        var cnn = Object.keys(this.state.collections).length
        var mnn = Object.keys(this.state.manifests).length
        var inn = Object.keys(this.state.images).length
        const activeWorkspace = this.getCurrentWorkspace()
        const workspaceItems = activeWorkspace.items || {}
        var wnn = Object.keys(workspaceItems).length

        let ms = []
        if(Object.keys(this.state.manifests).length>0) {
          for (let key in this.state.manifests) {
              ms.push(<
                  DisplayManifest
                  key = { `item-${this.state.manifests[key].id}` }
                  id = { this.state.manifests[key].id }
                  label = { this.state.manifests[key].label }
                  thumb = { this.state.manifests[key].thumb }
                  url = { this.state.manifests[key].url }
                  cors = { this.state.manifests[key].cors }
                  error = { this.state.manifests[key].error }
                  copyUrl = {this.copyUrl.bind(this)}
                  addToWorkspace = {this.addToWorkspace.bind(this)}
                  settings = {this.state.settings}
                  theme = {this.theme}
              />)
          }
        } else {
          ms = "No IIIF Manifests detected."
        }

        let cs = []
        if(Object.keys(this.state.collections).length>0) {
          // cs.push(<h3 key={'TABC'}>Presentation API: Collections<a name="ancc" /></h3>)
          for (let key in this.state.collections) {
              cs.push(<
                  DisplayCollection
                  key = { `item-${this.state.collections[key].id}` }
                  id = { this.state.collections[key].id }
                  label = { this.state.collections[key].label }
                  thumb = { this.state.collections[key].thumb }
                  url = { this.state.collections[key].url }
                  cors = { this.state.collections[key].cors }
                  error = { this.state.collections[key].error }
                  copyUrl = {this.copyUrl.bind(this)}
                  settings = {this.state.settings}
                  theme = {this.theme}
              />)
          }
        } else {
          cs = "No IIIF Collections detected."
        }

        let is = []
        if(Object.keys(this.state.images).length>0) {
          // is.push(<h3 key={'TABI'}>Image API<a name="anci" /></h3>)
          for (let key in this.state.images) {
              is.push(<
                  DisplayImage
                  key = { `item-${this.state.images[key].id}` }
                  id = { this.state.images[key].id }
                  label = { this.state.images[key].label }
                  thumb = { this.state.images[key].thumb }
                  url = { this.state.images[key].url }
                  cors = { this.state.images[key].cors }
                  error = { this.state.images[key].error }
                  version = { this.state.images[key].version }
                  copyUrl = {this.copyUrl.bind(this)}
                  settings = {this.state.settings}
                  theme = {this.theme}
              />)
          }
        } else {
          is = "No IIIF images detected."
        }

        let ws = []
        if(Object.keys(workspaceItems).length>0) {
          for (let key in workspaceItems) {
              ws.push(<
                  DisplayWorkspace
                  key = { `item-${workspaceItems[key].url}` }
                  id = { workspaceItems[key].id }
                  label = { workspaceItems[key].label }
                  thumb = { workspaceItems[key].thumb }
                  url = { workspaceItems[key].url }
                  cors = { workspaceItems[key].cors }
                  error = { workspaceItems[key].error }
                  copyUrl = {this.copyUrl.bind(this)}
                  removeFromWorkspace = {this.openRemDialog.bind(this)}
                  settings = {this.state.settings}
                  theme = {this.theme}
              />)
          }
        } else {
          ws = `${activeWorkspace.name} workspace is empty.`
        }

        // alert("APP "+JSON.stringify(this.state.manifests))

        let cc = ms.concat(cs,is,ws)
        if(cc.length==0) {
          cc.push("No IIIF content on this page.")
        }

        console.log("RENDER")

        let subHeaderContent = []
        let outputContent = []
        const workspaceOptions = Object.values(this.state.workspaces).length > 0
          ? Object.values(this.state.workspaces).sort((a, b) => (
          a.name.localeCompare(b.name)
        ))
          : [activeWorkspace]
        const workspaceControls = (
          <div className="WorkspaceControls" key="WORKSPACE-CONTROLS">
            <FormControl size="small" className="WorkspaceSelectControl">
              <InputLabel id="workspace-select-label">Workspace</InputLabel>
              <Select
                labelId="workspace-select-label"
                value={activeWorkspace.id}
                label="Workspace"
                onChange={this.setActiveWorkspace}
              >
                {workspaceOptions.map((workspace) => (
                  <MenuItem value={workspace.id} key={`workspace-option-${workspace.id}`}>
                    {workspace.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Tooltip title="Create workspace">
              <IconButton aria-label="Create workspace" size="small" onClick={this.createWorkspace}>
                <AddCircleOutlineIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Rename workspace">
              <IconButton aria-label="Rename workspace" size="small" onClick={this.renameActiveWorkspace}>
                <DriveFileRenameOutlineIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete workspace" describeChild>
              <span>
                <IconButton
                  aria-label="Delete workspace"
                  size="small"
                  onClick={this.deleteActiveWorkspace}
                  disabled={activeWorkspace.id === DEFAULT_WORKSPACE_ID}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </span>
            </Tooltip>
          </div>
        )

        if(this.defaults.tabs===true) {
          outputContent.push(
            <div key={"TABBOX2"}>
              <Tabs value={this.state.tab} onChange={(e,v)=>{this.setState({tab:v})}} aria-label="basic tabs example">
                <Tab label={"Manifests"+(mnn>0?` (${mnn})`:``)} value={0} {...a11yProps(0)} key={"TAB0"} />
                <Tab label={"Images"+(inn>0?` (${inn})`:``)} value={1} {...a11yProps(1)} key={"TAB1"} />
                <Tab label={"Collections"+(cnn>0?` (${cnn})`:``)} value={2}  {...a11yProps(2)} key={"TAB2"} />
                <Tab label={`Workspaces`+(wnn>0?` (${wnn})`:``)} value={3} {...a11yProps(3)} key={"TAB3"} />
                <Tab label="About" value={4} {...a11yProps(4)} key={"TAB4"} />
              </Tabs>
            </div>
          )
          outputContent.push(
            <div key={"TABBOX3"}>
              <TabPanel value={this.state.tab} index={0} key={"TABPANEL0"}>
                {ms}
              </TabPanel>
              <TabPanel value={this.state.tab} index={1} key={"TABPANEL1"}>
                {is}
              </TabPanel>
              <TabPanel value={this.state.tab} index={2} key={"TABPANEL2"}>
                {cs}
              </TabPanel>
              <TabPanel value={this.state.tab} index={3} key={"TABPANEL3"}>
                {workspaceControls}
                {Object.keys(this.state.settings.postWorkspaceCollectionTo).map(key =>
                  this.state.settings.postWorkspaceCollectionTo[key].tabWorkspaces===true ?
                  <PostButton
                    lang="en"
                    link={this.state.settings.postWorkspaceCollectionTo[key]}
                    theme={this.theme}
                    key={`postbutton-${v5(this.state.settings.postWorkspaceCollectionTo[key].url+key,'1b671a64-40d5-491e-99b0-d37347111f20')}`}
                    workspace={activeWorkspace}
                    workspaceItems={workspaceItems}
                    buildWorkspaceCollection={this.buildWorkspaceCollection}
                  /> : null
                )}
                <button onClick={() => this.copyWorkspaceCollection()} className="ButtonCopyWorkspace" key={"COPYWORKSPACECOLLECTION"}>Copy Workspace (JSON)</button>
                <button onClick={() => this.openRemDialog(null)} className="ButtonClearWorkspace" key={"CLEARWORKSPACECOLLECTION"}>Clear Workspace</button>
                <button onClick={() => this.openLocalMirador()} className="ButtonCopyWorkspace" key={"OPENWORKSPACEINLOCALMIRADOR"}>Local Mirador</button>
                <br key={v4()}/>
                <br key={v4()}/>
                {ws}
              </TabPanel>
              <TabPanel value={this.state.tab} index={4} key={"TABPANEL4"}>
                {this.theme.about}
                {'detektIIIF Version '}{this.softwareVersion}{' / Theme Version '}{this.themeVersion}
              </TabPanel>
            </div>
          )
        } else {
          switch(this.state.tab) {
            case 0:
              subHeaderContent.push(<h3 key={'TABM'} className="SubHeaderHeading">Available Manifests</h3>)
              // subHeaderContent.push(<div className="SubHeaderButtons" key={"SUBHEADERBUTTONS"}></div>)
              break
            case 4:
              subHeaderContent.push(<h3 key={'TABA'} className="SubHeaderHeading">About</h3>)
              // subHeaderContent.push(<div className="SubHeaderButtons" key={"SUBHEADERBUTTONS"}></div>)
              break
            case 3:
              subHeaderContent.push(<h3 key={'TABW'} className="SubHeaderHeading">Workspaces ({wnn})</h3>)
              subHeaderContent.push(
                <div className="SubHeaderButtons" key={"SUBHEADERBUTTONS"}>
                  {workspaceControls}
                  <button onClick={() => this.copyWorkspaceCollection()} className="ButtonCopyWorkspace" key={"COPYWORKSPACECOLLECTION"}>Copy Workspace (JSON)</button>
                  {Object.keys(this.state.settings.postWorkspaceCollectionTo).map(key =>
                    this.state.settings.postWorkspaceCollectionTo[key].tabWorkspaces===true ?
                    <PostButton
                      lang="en"
                      link={this.state.settings.postWorkspaceCollectionTo[key]}
                      theme={this.theme}
                      key={`postbutton-${v5(this.state.settings.postWorkspaceCollectionTo[key].url+key,'1b671a64-40d5-491e-99b0-d37347111f20')}`}
                      workspace={activeWorkspace}
                      workspaceItems={workspaceItems}
                      buildWorkspaceCollection={this.buildWorkspaceCollection}
                    /> : null
                  )}
                  <Tooltip title="Remove all workspace items">
                    {
                      this.theme.removeAllWorkspaceImage===null ?
                      <button onClick={() => this.openRemDialog(null)} className="ButtonClearWorkspace" key={"CLEARWORKSPACECOLLECTION"}>Remove All</button>
                      :
                      <IconButton color="primary" onClick={() => this.openRemDialog(null)} className="ButtonClearWorkspace" key={"CLEARWORKSPACECOLLECTION"}>
                        <img src={this.theme.removeAllWorkspaceImage}  className="iconSize" />
                      </IconButton>
                    }

                  </Tooltip>
                </div>
              )
              break
            default:
              break
          }
          outputContent.push(
            <div key={'TABBOX0'}>
                <TabPanel value={this.state.tab} index={0} key={"TABPANEL0"}>
                  {ms}
                </TabPanel>
                <TabPanel value={this.state.tab} index={1} key={"TABPANEL1"}>
                  {is}
                </TabPanel>
                <TabPanel value={this.state.tab} index={2} key={"TABPANEL2"}>
                  {cs}
                </TabPanel>
                <TabPanel value={this.state.tab} index={3} key={"TABPANEL3"}>
                  {ws}
                </TabPanel>
                <TabPanel value={this.state.tab} index={4} key={"TABPANEL4"}>
                  {this.theme.about}<br />
                  {'detektIIIF '}{this.softwareVersion}{' / Theme '}{this.themeVersion}
                </TabPanel>
            </div>
          )
        }

        this.themeVersion = chrome.runtime.getManifest().version
        this.softwareVersion = packageJson.version

        let header = null
        if(this.theme.logoImageBig) {
          header= <div className="App-header" key={'App-header-0'}>
                    <img src={this.theme.logoImageBig} className="Logo-image-Big" />
                    <small className="version" key={v4()}></small>
                    { this.theme.logoSecondaryImageBig ? <img src={this.theme.logoSecondaryImageBig} alt={this.theme.title} className="Logo-image-Secondary-Big" /> : null }
                  </div>
        } else {
          header= <div className="App-header" key={'App-header-0'}>
                    <h2 className="App-title" key={v4()}>{this.theme.title}<img src={this.theme.logoImage} className="Logo-image" /></h2>
                    <small className="version" key={v4()}></small>
                    { this.theme.logoSecondaryImageBig ? <img src={this.theme.logoSecondaryImageBig} alt={this.theme.title} className="Logo-image-Secondary-Big" /> : null }
                  </div>
        }

        console.log({Theme:this.theme})

        return(
          <div className="App" key={"App"}>
            {header}
            <div className="App-subheader" key={'App-subheader-0'}>
              {subHeaderContent}
              <div className="WorkspaceIcon" style={{display:(this.defaults.tabs===true?'none':'block')}} key={v4()}  >
                <Tooltip title={this.state.tab===0 ? "Open Workspaces" : "Close Workspaces"}>
                <IconButton color="primary"
                  aria-label="Workspaces"
                  component="span"
                  onClick={ () => {
                    this.setState({tab: this.state.tab!==0?0:3 })
                  } }
                >
                  <Badge
                    badgeContent={this.state.tab===0?Object.keys(workspaceItems).length:0}
                    className="WorkspaceBadge"
                  >
                    {
                      this.state.tab===0 ?
                      (this.theme.workspaceImage!==null ? <img src={this.theme.workspaceImage} className="WorkspaceIconImage"/> : <WorkspacesOutlinedIcon />)
                      :
                      (this.theme.closeWorkspaceImage!==null ? <img src={this.theme.closeWorkspaceImage} className="WorkspaceIconImage"/> : <CancelOutlinedIcon />)
                    }
                  </Badge>
                </IconButton>
                </Tooltip>
              </div>
            </div>

            <div className="App-body" key={'App-body-0'}>
              {outputContent}
            </div>

            <div className="App-footer" key={'App-footer-0'}>
              <span>
                <a href="#" onClick={ () => { this.setState({tab:4}) } } key={"FOOTERABOUT"}>About</a>
                &nbsp;|&nbsp;
                <a href="#" onClick={ () => { chrome.runtime.openOptionsPage() } } key={"FOOTEROPTIONS"}>Options</a>
                &nbsp;|&nbsp;
                <a href="#" onClick={ () => { this.openLocalMirador() } } key={"FOOTERMIRADOR"}>Mirador</a>
              </span>
            </div>

            <Dialog open={this.state.remDialog}>
              <DialogTitle id="alert-dialog-title">
                {this.state.remKey===null?"Remove all items from this workspace?":"Remove this item from the workspace?"}
              </DialogTitle>
              <DialogContent>
                <DialogContentText>
                </DialogContentText>
              </DialogContent>
              <DialogActions>
                <Button onClick={this.closeRemDialog}>No</Button>
                <Button onClick={this.removeOperation} autoFocus>Yes</Button>
              </DialogActions>
            </Dialog>

            <Snackbar
              open={this.state.snackOpen}
              onClose={() => this.setState({snackOpen:false})}
              autoHideDuration={1000}
              anchorOrigin={{vertical:'top',horizontal:'center'}}
              message={this.state.snackMsg}
              key={`snack-${this.state.snackMsg}`}
            />

          </div>
        )

    }
}

export default Popup
