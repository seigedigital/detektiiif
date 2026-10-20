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
  WORKSPACE_INDEX_STORAGE_KEY,
  addItemToWorkspace,
  addWorkspace,
  clearWorkspace,
  deleteWorkspace,
  getActiveWorkspace,
  loadWorkspaceState,
  removeItemFromWorkspace,
  renameWorkspace,
  setActiveWorkspace,
} from "../../shared/workspaces"
import {
  addGitHubWorkspaceCollaborator,
  deleteGitHubWorkspaceRepository,
  ensureGitHubWorkspaceRepository,
  forgetGitHubWorkspaceRepository,
  getAuthenticatedGitHubUser,
  getGitHubWorkspaceRepositoryAccess,
  listGitHubWorkspaceCollaborators,
  listGitHubWorkspaceInvitations,
  listGitHubWorkspaceRepositories,
  openGitHubWorkspaceRepository,
  rememberGitHubWorkspaceRepository,
  removeGitHubWorkspaceCollaborator,
  removeGitHubWorkspaceInvitation,
  renameGitHubWorkspaceRepository,
  updateGitHubWorkspaceRepositoryVisibility,
} from "../../shared/storage/githubWorkspaceStore"
import {
  WORKSPACE_STORAGE_SETTINGS_KEY,
  getGitHubRepositorySlug,
  hasGitHubToken,
  loadWorkspaceStorageSettings,
  parseGitHubRepository,
  saveWorkspaceStorageSettings,
  WORKSPACE_STORAGE_BACKENDS,
} from "../../shared/storage/storageSettings"
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
import Backdrop from '@mui/material/Backdrop';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

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
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';

import packageJson from '../../../package.json'

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
            activeGitHubRepository: '',
            githubTokenConfigured: false,
            githubStorageSelected: false,
            githubWorkspaceAccess: null,
            githubWorkspaceRepositories: [],
            githubWorkspacesLoading: false,
            openRepositoryDialogOpen: false,
            openRepositoryInput: '',
            repositoryWorkspaceStorage: false,
            remDialog: false,
            remKey: null,
            snackOpen: false,
            snackMsg: '',
            workspaceBusy: false,
            workspaceBusyMessage: '',
            workspaceErrorMessage: '',
            workspaceErrorOpen: false,
            workspaceErrorTitle: '',
            shareCollaboratorPermission: 'push',
            shareCollaboratorUsername: '',
            shareCollaborators: [],
            shareDialogOpen: false,
            shareInvitations: [],
        }
        this.copyWorkspaceCollection = this.copyWorkspaceCollection.bind(this)
        this.closeRemDialog = this.closeRemDialog.bind(this)
        this.closeWorkspaceError = this.closeWorkspaceError.bind(this)
        this.openRemDialog = this.openRemDialog.bind(this)
        this.removeOperation = this.removeOperation.bind(this)
        this.getDataFromLocalStorage = this.getDataFromLocalStorage.bind(this)
        this.openLocalMirador = this.openLocalMirador.bind(this)
        this.loadWorkspaces = this.loadWorkspaces.bind(this)
        this.addToWorkspace = this.addToWorkspace.bind(this)
        this.createWorkspace = this.createWorkspace.bind(this)
        this.renameActiveWorkspace = this.renameActiveWorkspace.bind(this)
        this.deleteActiveWorkspace = this.deleteActiveWorkspace.bind(this)
        this.handleTabChange = this.handleTabChange.bind(this)
        this.setActiveWorkspace = this.setActiveWorkspace.bind(this)
        this.selectGitHubWorkspaceRepository = this.selectGitHubWorkspaceRepository.bind(this)
        this.addWorkspaceCollaborator = this.addWorkspaceCollaborator.bind(this)
        this.cancelWorkspaceInvitation = this.cancelWorkspaceInvitation.bind(this)
        this.changeWorkspaceVisibility = this.changeWorkspaceVisibility.bind(this)
        this.closeOpenRepositoryDialog = this.closeOpenRepositoryDialog.bind(this)
        this.closeWorkspaceShareDialog = this.closeWorkspaceShareDialog.bind(this)
        this.openRepositoryDialog = this.openRepositoryDialog.bind(this)
        this.openSharedWorkspace = this.openSharedWorkspace.bind(this)
        this.openWorkspaceShareDialog = this.openWorkspaceShareDialog.bind(this)
        this.removeWorkspaceCollaborator = this.removeWorkspaceCollaborator.bind(this)
        this.handleStorageChange = this.handleStorageChange.bind(this)
        this.githubWorkspaceRepositoryListToken = ''
        this.githubWorkspaceRepositoryListPromise = null
        this.githubWorkspaceRepositoryListPromiseToken = ''
        this.githubWorkspaceRepositoryRefreshRequested = false
        this.workspaceLoadGeneration = 0
    }

    handleStorageChange(changes, namespace) {
      let reloadWorkspaces = false
      let refreshGitHubRepositories = false

      for (const [key, { newValue }] of Object.entries(changes)) {
        if(namespace === "local" && key === "showUrl") {
          this.setState({settings:Object.assign({},this.state.settings,{showUrl:newValue})})
        }

        if(namespace === "local" && key === "postWorkspaceCollectionTo") {
          this.setState({settings:Object.assign({},this.state.settings,{postWorkspaceCollectionTo:normalizeWorkspaceLinks(newValue)})})
        }

        if(namespace === "local" && key === "openManifestLinks") {
          this.setState({settings:Object.assign({},this.state.settings,{openManifestLinks:normalizeWorkspaceLinks(newValue)})})
        }

        if(namespace === "sync" && (
          key === "workspaces" ||
          key === WORKSPACE_INDEX_STORAGE_KEY ||
          key === "activeWorkspaceId"
        )) {
          reloadWorkspaces = true
        }

        if(namespace === "local" && key === WORKSPACE_STORAGE_SETTINGS_KEY) {
          this.githubWorkspaceRepositoryRefreshRequested = false
          reloadWorkspaces = true
          refreshGitHubRepositories = this.state.tab === 3
        }
      }

      if (reloadWorkspaces) {
        this.loadWorkspaces({ refreshGitHubRepositories })
      }
    }

    getDataFromLocalStorage() {
        return new Promise((resolve) => getCurrentTab((tab) => {
            chrome.storage.local.get(['tabStorage'], (result) => {
              try {
                if('tabStorage' in result) {
                  const tabStorage = JSON.parse(result['tabStorage'])
                  if(tabStorage[tab.id] !== undefined) {
                    this.setState(Object.assign({},tabStorage[tab.id]['iiif']), resolve)
                    return
                  }
                }
              } catch (error) {
                console.warn('Could not read detected IIIF resources.', error)
              }
              this.setState({manifests:{},collections:{},images:{}}, resolve)
            })
        }))
    }

    async componentDidMount() {
        await Promise.all([
          this.getDataFromLocalStorage(),
          this.loadWorkspaces(),
        ])
        chrome.storage.onChanged.addListener(this.handleStorageChange)
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

    componentWillUnmount() {
      chrome.storage.onChanged.removeListener(this.handleStorageChange)
      this.workspaceLoadGeneration += 1
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
          if('openManifestLinks' in data) {
            this.setState({settings:Object.assign({},this.state.settings,{
              openManifestLinks: normalizeWorkspaceLinks(data.openManifestLinks)
            })})
          }
        })
        chrome.storage.local.get('showUrl', (data) => {
          if('showUrl' in data) { this.setState({settings:Object.assign({},this.state.settings,data)}) }
        })
    }

    openLocalMirador() {
      chrome.tabs.create({'url': `miradorpage.html?workspace=${encodeURIComponent(this.state.activeWorkspaceId)}`})
    }

    setWorkspaceBusy(message) {
      this.setState({
        workspaceBusy: true,
        workspaceBusyMessage: message,
      })
    }

    clearWorkspaceBusy() {
      this.setState({
        workspaceBusy: false,
        workspaceBusyMessage: '',
      })
    }

    closeWorkspaceError() {
      this.setState({
        workspaceErrorMessage: '',
        workspaceErrorOpen: false,
        workspaceErrorTitle: '',
      })
    }

    handleWorkspaceError(error, prefix = 'Workspace operation failed') {
      console.error(error)
      this.setState({
        workspaceErrorMessage: error.message || String(error),
        workspaceErrorOpen: true,
        workspaceErrorTitle: prefix,
      })
    }

    async runWorkspaceOperation(message, operation, errorPrefix = 'Workspace operation failed') {
      this.setWorkspaceBusy(message)

      try {
        return await operation()
      } catch (error) {
        this.handleWorkspaceError(error, errorPrefix)
        return null
      } finally {
        this.clearWorkspaceBusy()
      }
    }

    buildPlaceholderWorkspaceState(name = 'Select a GitHub workspace') {
      const timestamp = new Date().toISOString()

      return {
        activeWorkspaceId: DEFAULT_WORKSPACE_ID,
        workspaces: {
          [DEFAULT_WORKSPACE_ID]: {
            annotations: {},
            annotationsUpdatedAt: timestamp,
            id: DEFAULT_WORKSPACE_ID,
            items: {},
            itemsUpdatedAt: timestamp,
            name,
            updatedAt: timestamp,
          },
        },
      }
    }

    async getWorkspaceStorageSettings() {
      return loadWorkspaceStorageSettings()
    }

    async getGitHubRepositoryInputConfig(input) {
      const settings = await this.getWorkspaceStorageSettings()
      const trimmedInput = String(input || '').trim()

      if (!trimmedInput) {
        return null
      }

      let repository = parseGitHubRepository(trimmedInput)

      if (!repository.owner || !repository.repo) {
        const user = await getAuthenticatedGitHubUser(settings.github)
        repository = {
          owner: user.login,
          repo: trimmedInput.replace(/\.git$/i, ''),
        }
      }

      return {
        ...settings.github,
        owner: repository.owner,
        repo: repository.repo,
      }
    }

    async saveSelectedGitHubRepository(repository) {
      const settings = await this.getWorkspaceStorageSettings()
      const savedSettings = await saveWorkspaceStorageSettings({
        ...settings,
        backend: WORKSPACE_STORAGE_BACKENDS.GITHUB,
        github: {
          ...settings.github,
          owner: repository.owner,
          repo: repository.repo,
        },
      })

      return savedSettings
    }

    mergeActiveGitHubRepositoryOption(repositories, activeGitHubRepository, workspaceState) {
      if (!activeGitHubRepository || repositories.some((repository) => (
        repository.fullName === activeGitHubRepository
      ))) {
        return repositories
      }

      const [owner, repo] = activeGitHubRepository.split('/')
      const activeWorkspace = workspaceState?.workspaces?.[workspaceState.activeWorkspaceId]

      if (!owner || !repo) {
        return repositories
      }

      return [
        ...repositories,
        {
          defaultBranch: 'main',
          fullName: activeGitHubRepository,
          htmlUrl: `https://github.com/${activeGitHubRepository}`,
          id: activeGitHubRepository,
          name: activeWorkspace?.name || repo,
          owner,
          permissions: {},
          private: false,
          repo,
          updatedAt: activeWorkspace?.updatedAt || '',
          workspaceId: activeWorkspace?.id || DEFAULT_WORKSPACE_ID,
        },
      ].sort((a, b) => a.name.localeCompare(b.name))
    }

    rememberLoadedGitHubWorkspaceRepositories(token, repositories) {
      this.githubWorkspaceRepositoryListToken = token
      this.setState({
        githubWorkspaceRepositories: repositories,
      })
    }

    async loadGitHubWorkspaceRepositories(storageSettings) {
      const token = storageSettings.github.token

      if (this.githubWorkspaceRepositoryListToken === token) {
        return this.state.githubWorkspaceRepositories
      }

      if (
        this.githubWorkspaceRepositoryListPromise &&
        this.githubWorkspaceRepositoryListPromiseToken === token
      ) {
        return this.githubWorkspaceRepositoryListPromise
      }

      this.githubWorkspaceRepositoryListPromiseToken = token
      this.githubWorkspaceRepositoryListPromise = listGitHubWorkspaceRepositories(storageSettings.github)
        .then((repositories) => {
          this.githubWorkspaceRepositoryListToken = token
          return repositories
        })
        .catch((error) => {
          this.githubWorkspaceRepositoryListToken = token
          throw error
        })
        .finally(() => {
          this.githubWorkspaceRepositoryListPromise = null
          this.githubWorkspaceRepositoryListPromiseToken = ''
        })

      return this.githubWorkspaceRepositoryListPromise
    }

    getCurrentWorkspace() {
      return getActiveWorkspace(this.state.workspaces, this.state.activeWorkspaceId)
    }

    getCurrentWorkspaceItems() {
      return this.getCurrentWorkspace().items || {}
    }

    isCurrentWorkspaceReadOnly() {
      return Boolean(
        this.state.repositoryWorkspaceStorage &&
        this.state.activeGitHubRepository &&
        !this.state.githubWorkspaceAccess?.canPush
      )
    }

    requireWritableWorkspace() {
      if (!this.isCurrentWorkspaceReadOnly()) {
        return true
      }

      this.handleWorkspaceError(
        new Error('You have read-only access to this GitHub workspace.'),
        'Workspace is read-only'
      )
      return false
    }

    async loadWorkspaces(options = {}) {
      const loadGeneration = ++this.workspaceLoadGeneration
      try {
        const refreshGitHubRepositories = Boolean(options.refreshGitHubRepositories)
        const suppressWorkspaceError = Boolean(options.suppressWorkspaceError)
        const storageSettings = await loadWorkspaceStorageSettings()
        const githubStorageSelected = storageSettings.backend === WORKSPACE_STORAGE_BACKENDS.GITHUB
        const repositoryWorkspaceStorage = githubStorageSelected
        const githubTokenConfigured = (
          githubStorageSelected &&
          hasGitHubToken(storageSettings)
        )
        const activeGitHubRepository = getGitHubRepositorySlug(storageSettings.github)
        let githubWorkspaceRepositories = (
          this.githubWorkspaceRepositoryListToken === storageSettings.github.token
            ? this.state.githubWorkspaceRepositories
            : []
        )
        let workspaceState = null
        let githubWorkspaceAccess = null
        let workspaceError = null
        let repositoryListError = null
        const shouldLoadGitHubRepositories = githubTokenConfigured && refreshGitHubRepositories

        if (loadGeneration !== this.workspaceLoadGeneration) {
          return
        }

        this.setState({
          activeGitHubRepository,
          githubStorageSelected,
          githubTokenConfigured,
          githubWorkspaceAccess: null,
          githubWorkspacesLoading: shouldLoadGitHubRepositories,
          repositoryWorkspaceStorage,
        })

        if (shouldLoadGitHubRepositories) {
          try {
            githubWorkspaceRepositories = await this.loadGitHubWorkspaceRepositories(storageSettings)
          } catch (error) {
            repositoryListError = error
          }
        } else if (!githubTokenConfigured) {
          this.githubWorkspaceRepositoryListToken = ''
          this.githubWorkspaceRepositoryRefreshRequested = false
        }

        if (loadGeneration !== this.workspaceLoadGeneration) {
          return
        }

        try {
          workspaceState = await loadWorkspaceState()
        } catch (error) {
          workspaceError = error
          workspaceState = this.buildPlaceholderWorkspaceState(
            activeGitHubRepository
              ? `Could not load ${activeGitHubRepository}`
              : 'Select a GitHub workspace'
          )
        }

        if (githubStorageSelected && activeGitHubRepository) {
          try {
            githubWorkspaceAccess = await getGitHubWorkspaceRepositoryAccess(storageSettings.github)
          } catch (error) {
            if (!workspaceError) {
              workspaceError = error
            }
          }
        }

        if (!workspaceError) {
          githubWorkspaceRepositories = this.mergeActiveGitHubRepositoryOption(
            githubWorkspaceRepositories,
            activeGitHubRepository,
            workspaceState
          )
        }

        if (loadGeneration !== this.workspaceLoadGeneration) {
          return
        }

        await new Promise((resolve) => this.setState({
            ...workspaceState,
            activeGitHubRepository,
            githubStorageSelected,
            githubTokenConfigured,
            githubWorkspaceAccess,
            githubWorkspaceRepositories,
            githubWorkspacesLoading: false,
            repositoryWorkspaceStorage,
          }, resolve))

        if (workspaceError && !suppressWorkspaceError) {
          this.handleWorkspaceError(workspaceError, 'Workspace could not be loaded')
        } else if (repositoryListError) {
          this.handleWorkspaceError(repositoryListError, 'GitHub workspaces could not be listed')
        }
      } catch (error) {
        this.setState({ githubWorkspacesLoading: false })
        this.handleWorkspaceError(error, 'Workspace settings could not be loaded')
      }
    }

    handleTabChange(event, value) {
      this.setState({ tab: value }, () => {
        if (value === 3) {
          this.refreshGitHubWorkspaceRepositoryOptions()
        }
      })
    }

    refreshGitHubWorkspaceRepositoryOptions() {
      if (this.githubWorkspaceRepositoryRefreshRequested) {
        return
      }

      this.githubWorkspaceRepositoryRefreshRequested = true
      this.loadWorkspaces({
        refreshGitHubRepositories: true,
        suppressWorkspaceError: true,
      })
    }

    async setActiveWorkspace(eventOrId) {
      const workspaceId = eventOrId && eventOrId.target ? eventOrId.target.value : eventOrId
      const message = this.state.repositoryWorkspaceStorage
        ? 'Switching GitHub workspace...'
        : 'Switching workspace...'

      await this.runWorkspaceOperation(message, async () => {
        if (this.state.repositoryWorkspaceStorage) {
          await this.selectGitHubWorkspaceRepository(workspaceId)
          return
        }

        const workspaceState = await setActiveWorkspace(workspaceId)
        this.setState(workspaceState)
      }, 'Workspace could not be switched')
    }

    async selectGitHubWorkspaceRepository(repositoryId) {
      const repository = this.state.githubWorkspaceRepositories.find((item) => (
        item.fullName === repositoryId || item.id === repositoryId
      ))

      if (!repository) {
        return
      }

      await this.saveSelectedGitHubRepository(repository)
      await this.loadWorkspaces()
    }

    openRepositoryDialog() {
      this.setState({
        openRepositoryDialogOpen: true,
        openRepositoryInput: '',
      })
    }

    closeOpenRepositoryDialog() {
      if (!this.state.workspaceBusy) {
        this.setState({
          openRepositoryDialogOpen: false,
          openRepositoryInput: '',
        })
      }
    }

    async openSharedWorkspace() {
      const input = this.state.openRepositoryInput.trim()

      if (!input) {
        return
      }

      await this.runWorkspaceOperation('Opening shared GitHub workspace...', async () => {
        const config = await this.getGitHubRepositoryInputConfig(input)
        const repository = await openGitHubWorkspaceRepository(config)

        if (config.token) {
          try {
            const repositories = await rememberGitHubWorkspaceRepository(config, repository)
            this.rememberLoadedGitHubWorkspaceRepositories(config.token, repositories)
          } catch (error) {
            console.warn('Could not add shared workspace to the private registry.', error)
          }
        }

        await this.saveSelectedGitHubRepository(repository)
        this.setState({
          openRepositoryDialogOpen: false,
          openRepositoryInput: '',
        })
        await this.loadWorkspaces()
        this.setState({
          snackOpen: true,
          snackMsg: `${repository.fullName} was opened.`,
        })
      }, 'Shared GitHub workspace could not be opened')
    }

    closeWorkspaceShareDialog() {
      if (!this.state.workspaceBusy) {
        this.setState({ shareDialogOpen: false })
      }
    }

    async loadWorkspaceSharing() {
      const settings = await this.getWorkspaceStorageSettings()
      const access = await getGitHubWorkspaceRepositoryAccess(settings.github)
      let collaborators = []
      let invitations = []

      if (access.canAdmin) {
        [collaborators, invitations] = await Promise.all([
          listGitHubWorkspaceCollaborators(settings.github),
          listGitHubWorkspaceInvitations(settings.github),
        ])
      }

      this.setState({
        githubWorkspaceAccess: access,
        shareCollaboratorPermission: access.ownerType === 'User'
          ? 'push'
          : this.state.shareCollaboratorPermission,
        shareCollaborators: collaborators,
        shareInvitations: invitations,
      })

      return access
    }

    async openWorkspaceShareDialog() {
      if (!this.state.activeGitHubRepository) {
        return
      }

      this.setState({
        shareCollaboratorPermission: 'push',
        shareCollaboratorUsername: '',
        shareDialogOpen: true,
      })
      await this.runWorkspaceOperation(
        'Loading sharing settings...',
        () => this.loadWorkspaceSharing(),
        'Sharing settings could not be loaded'
      )
    }

    async addWorkspaceCollaborator() {
      const username = this.state.shareCollaboratorUsername.trim()

      if (!username) {
        return
      }

      await this.runWorkspaceOperation('Inviting GitHub collaborator...', async () => {
        const settings = await this.getWorkspaceStorageSettings()
        await addGitHubWorkspaceCollaborator(
          settings.github,
          username,
          this.state.shareCollaboratorPermission
        )
        this.setState({ shareCollaboratorUsername: '' })
        await this.loadWorkspaceSharing()
      }, 'GitHub collaborator could not be invited')
    }

    async removeWorkspaceCollaborator(username) {
      if (!window.confirm(`Remove ${username} from this workspace?`)) {
        return
      }

      await this.runWorkspaceOperation('Removing GitHub collaborator...', async () => {
        const settings = await this.getWorkspaceStorageSettings()
        await removeGitHubWorkspaceCollaborator(settings.github, username)
        await this.loadWorkspaceSharing()
      }, 'GitHub collaborator could not be removed')
    }

    async cancelWorkspaceInvitation(invitationId, username) {
      if (!window.confirm(`Cancel the invitation for ${username}?`)) {
        return
      }

      await this.runWorkspaceOperation('Cancelling GitHub invitation...', async () => {
        const settings = await this.getWorkspaceStorageSettings()
        await removeGitHubWorkspaceInvitation(settings.github, invitationId)
        await this.loadWorkspaceSharing()
      }, 'GitHub invitation could not be cancelled')
    }

    async changeWorkspaceVisibility(event) {
      const visibility = event.target.value

      if (
        visibility === 'public' &&
        !window.confirm('Make this workspace public? Anyone with the link will be able to read it.')
      ) {
        return
      }

      await this.runWorkspaceOperation('Updating repository visibility...', async () => {
        const settings = await this.getWorkspaceStorageSettings()
        await updateGitHubWorkspaceRepositoryVisibility(settings.github, visibility)
        await this.loadWorkspaceSharing()
        this.setState({
          snackOpen: true,
          snackMsg: `Workspace is now ${visibility}.`,
        })
      }, 'Repository visibility could not be changed')
    }

    async createWorkspace() {
      if (this.state.repositoryWorkspaceStorage) {
        const input = window.prompt('GitHub workspace repository name')

        if (!input) {
          return
        }

        await this.runWorkspaceOperation('Preparing GitHub workspace...', async () => {
          const config = await this.getGitHubRepositoryInputConfig(input)

          if (!config) {
            return
          }

          const repository = await ensureGitHubWorkspaceRepository(config, {
            name: config.repo,
            visibility: 'private',
          })
          const githubWorkspaceRepositories = await rememberGitHubWorkspaceRepository(config, {
            ...repository,
            repo: repository.name,
            workspaceId: DEFAULT_WORKSPACE_ID,
          })
          this.rememberLoadedGitHubWorkspaceRepositories(config.token, githubWorkspaceRepositories)
          await this.saveSelectedGitHubRepository({
            owner: repository.owner,
            repo: repository.name,
          })
          await this.loadWorkspaces()
          this.setState({
            snackOpen: true,
            snackMsg: `${repository.fullName} is ready.`,
          })
        }, 'GitHub workspace could not be prepared')
        return
      }

      const name = window.prompt('Workspace name')
      if (!name) {
        return
      }

      await this.runWorkspaceOperation('Creating workspace...', async () => {
        const workspaceState = await addWorkspace(name)
        this.setState(workspaceState)
      }, 'Workspace could not be created')
    }

    async renameActiveWorkspace() {
      if (
        this.state.repositoryWorkspaceStorage &&
        !this.state.githubWorkspaceAccess?.canAdmin
      ) {
        this.handleWorkspaceError(
          new Error('Only repository administrators can rename this GitHub workspace.'),
          'Workspace cannot be renamed'
        )
        return
      }

      const workspace = this.getCurrentWorkspace()
      const name = window.prompt(
        this.state.repositoryWorkspaceStorage ? 'GitHub workspace repository name' : 'Workspace name',
        this.state.repositoryWorkspaceStorage ? this.state.activeGitHubRepository.split('/').pop() : workspace.name
      )
      if (!name) {
        return
      }

      await this.runWorkspaceOperation(
        this.state.repositoryWorkspaceStorage ? 'Renaming GitHub workspace...' : 'Renaming workspace...',
        async () => {
        if (this.state.repositoryWorkspaceStorage) {
          const settings = await this.getWorkspaceStorageSettings()
          const previousRepository = getGitHubRepositorySlug(settings.github)
          const repository = await renameGitHubWorkspaceRepository(settings.github, name)

          let githubWorkspaceRepositories = await rememberGitHubWorkspaceRepository(settings.github, {
            ...repository,
            repo: repository.name,
            workspaceId: DEFAULT_WORKSPACE_ID,
          })

          if (previousRepository && previousRepository !== repository.fullName) {
            githubWorkspaceRepositories = await forgetGitHubWorkspaceRepository(settings.github, previousRepository)
          }

          this.rememberLoadedGitHubWorkspaceRepositories(settings.github.token, githubWorkspaceRepositories)
          await this.saveSelectedGitHubRepository({
            owner: repository.owner,
            repo: repository.name,
          })
          await this.loadWorkspaces()
          this.setState({
            snackOpen: true,
            snackMsg: `${repository.fullName} was renamed.`,
          })
          return
        }

        const workspaceState = await renameWorkspace(workspace.id, name)
        this.setState(workspaceState)
        },
        'Workspace could not be renamed'
      )
    }

    async deleteActiveWorkspace() {
      if (this.state.repositoryWorkspaceStorage) {
        if (!this.state.activeGitHubRepository) {
          return
        }

        if (!this.state.githubWorkspaceAccess?.canAdmin) {
          this.handleWorkspaceError(
            new Error('Only repository administrators can delete this GitHub workspace.'),
            'Workspace cannot be deleted'
          )
          return
        }

        if (!window.confirm(`Delete GitHub workspace repository "${this.state.activeGitHubRepository}"? This cannot be undone.`)) {
          return
        }

        await this.runWorkspaceOperation('Deleting GitHub workspace...', async () => {
          const settings = await this.getWorkspaceStorageSettings()
          const previousRepository = getGitHubRepositorySlug(settings.github)
          const deletedRepository = await deleteGitHubWorkspaceRepository(settings.github)
          const githubWorkspaceRepositories = await forgetGitHubWorkspaceRepository(settings.github, previousRepository)
          this.rememberLoadedGitHubWorkspaceRepositories(settings.github.token, githubWorkspaceRepositories)
          await saveWorkspaceStorageSettings({
            ...settings,
            github: {
              ...settings.github,
              owner: '',
              repo: '',
            },
          })
          await this.loadWorkspaces()
          this.setState({
            snackOpen: true,
            snackMsg: `${deletedRepository.fullName} was deleted.`,
          })
        }, 'GitHub workspace could not be deleted')
        return
      }

      const workspace = this.getCurrentWorkspace()
      if (workspace.id === DEFAULT_WORKSPACE_ID) {
        return
      }

      if (!window.confirm(`Delete workspace "${workspace.name}"?`)) {
        return
      }

      await this.runWorkspaceOperation('Deleting workspace...', async () => {
        const workspaceState = await deleteWorkspace(workspace.id)
        this.setState(workspaceState)
      }, 'Workspace could not be deleted')
    }

    async addToWorkspace(key) {
      if (!this.requireWritableWorkspace()) {
        return
      }

      const manifest = this.state.manifests[key]
      if (!manifest) {
        return
      }

      await this.runWorkspaceOperation('Adding manifest to workspace...', async () => {
        const workspaceState = await addItemToWorkspace(
          this.state.activeWorkspaceId,
          key,
          manifest
        )
        this.setState(workspaceState)
      }, 'Manifest could not be added to the workspace')
    }

    openRemDialog(key) {
      this.setState({remDialog:true,remKey:key})
    }

    closeRemDialog(key) {
      this.setState({remDialog:false,remKey:null})
    }

    async removeOperation() {
      if (!this.requireWritableWorkspace()) {
        this.closeRemDialog()
        return
      }

      const remKey = this.state.remKey
      const message = remKey === null
        ? 'Clearing workspace...'
        : 'Removing item from workspace...'

      this.closeRemDialog()

      await this.runWorkspaceOperation(message, async () => {
        let workspaceState
        if(remKey!==null) {
          workspaceState = await removeItemFromWorkspace(
            this.state.activeWorkspaceId,
            remKey
          )
        } else {
          workspaceState = await clearWorkspace(this.state.activeWorkspaceId)
        }
        this.setState(workspaceState)
      }, 'Workspace could not be updated')
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
                  workspaceReadOnly = {this.isCurrentWorkspaceReadOnly()}
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
                  workspaceReadOnly = {this.isCurrentWorkspaceReadOnly()}
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

        let subHeaderContent = []
        let outputContent = []
        const browserWorkspaceOptions = Object.values(this.state.workspaces).length > 0
          ? Object.values(this.state.workspaces).sort((a, b) => (
          a.name.localeCompare(b.name)
        ))
          : [activeWorkspace]
        const githubWorkspaceOptions = this.state.githubWorkspaceRepositories
        const workspaceOptions = this.state.repositoryWorkspaceStorage
          ? githubWorkspaceOptions
          : browserWorkspaceOptions
        const hasGitHubWorkspaceSelection = Boolean(
          this.state.activeGitHubRepository &&
          githubWorkspaceOptions.some((repository) => repository.fullName === this.state.activeGitHubRepository)
        )
        const workspaceSelectValue = this.state.repositoryWorkspaceStorage
          ? (hasGitHubWorkspaceSelection ? this.state.activeGitHubRepository : '')
          : activeWorkspace.id
        const canCreateWorkspace = this.state.repositoryWorkspaceStorage
          ? this.state.githubTokenConfigured
          : true
        const canRenameWorkspace = this.state.repositoryWorkspaceStorage
          ? hasGitHubWorkspaceSelection && Boolean(this.state.githubWorkspaceAccess?.canAdmin)
          : true
        const canDeleteWorkspace = this.state.repositoryWorkspaceStorage
          ? hasGitHubWorkspaceSelection && Boolean(this.state.githubWorkspaceAccess?.canAdmin)
          : activeWorkspace.id !== DEFAULT_WORKSPACE_ID
        const workspaceReadOnly = this.isCurrentWorkspaceReadOnly()
        const workspaceControls = (
          <div className="WorkspaceControls" key="WORKSPACE-CONTROLS">
            <FormControl size="small" className="WorkspaceSelectControl">
              <InputLabel id="workspace-select-label">Workspace</InputLabel>
              <Select
                labelId="workspace-select-label"
                value={workspaceSelectValue}
                label="Workspace"
                onChange={this.setActiveWorkspace}
                disabled={this.state.workspaceBusy}
              >
                {workspaceOptions.length > 0 ? workspaceOptions.map((workspace) => (
                  <MenuItem
                    value={this.state.repositoryWorkspaceStorage ? workspace.fullName : workspace.id}
                    key={`workspace-option-${this.state.repositoryWorkspaceStorage ? workspace.fullName : workspace.id}`}
                  >
                    {this.state.repositoryWorkspaceStorage ? workspace.fullName : workspace.name}
                  </MenuItem>
                )) : (
                  <MenuItem value="" disabled>
                    {this.state.githubWorkspacesLoading ? 'Loading GitHub workspaces...' : 'No GitHub workspaces found'}
                  </MenuItem>
                )}
              </Select>
            </FormControl>
            <Tooltip title={this.state.repositoryWorkspaceStorage ? "Create GitHub workspace repository" : "Create workspace"} describeChild>
              <span>
                <IconButton
                  aria-label="Create workspace"
                  disabled={!canCreateWorkspace || this.state.workspaceBusy}
                  size="small"
                  onClick={this.createWorkspace}
                >
                  <AddCircleOutlineIcon />
                </IconButton>
              </span>
            </Tooltip>
            {this.state.repositoryWorkspaceStorage ? (
              <Tooltip title="Open shared GitHub workspace">
                <span>
                  <IconButton
                    aria-label="Open shared workspace"
                    disabled={this.state.workspaceBusy}
                    size="small"
                    onClick={this.openRepositoryDialog}
                  >
                    <FolderOpenOutlinedIcon />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
            <Tooltip title="Rename workspace">
              <span>
              <IconButton
                aria-label="Rename workspace"
                disabled={!canRenameWorkspace || this.state.workspaceBusy}
                size="small"
                onClick={this.renameActiveWorkspace}
              >
                <DriveFileRenameOutlineIcon />
              </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={this.state.repositoryWorkspaceStorage ? "Delete GitHub workspace repository" : "Delete workspace"} describeChild>
              <span>
                <IconButton
                  aria-label="Delete workspace"
                  size="small"
                  onClick={this.deleteActiveWorkspace}
                  disabled={!canDeleteWorkspace || this.state.workspaceBusy}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </span>
            </Tooltip>
            {this.state.repositoryWorkspaceStorage ? (
              <Tooltip title="Share workspace">
                <span>
                  <IconButton
                    aria-label="Share workspace"
                    disabled={!hasGitHubWorkspaceSelection || this.state.workspaceBusy}
                    size="small"
                    onClick={this.openWorkspaceShareDialog}
                  >
                    <ShareOutlinedIcon />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
          </div>
        )
        const workspaceStorageHint = this.state.repositoryWorkspaceStorage && workspaceReadOnly
          ? (
            <Typography variant="body2" key="WORKSPACE-STORAGE-HINT">
              Read-only GitHub workspace. Ask its owner for Editor access to change items or annotations.
            </Typography>
          )
          : (
            this.state.repositoryWorkspaceStorage && !hasGitHubWorkspaceSelection
              ? (
                <Typography variant="body2" key="WORKSPACE-STORAGE-HINT">
                  Open a shared repository or create a GitHub workspace{this.state.githubTokenConfigured ? '.' : ' after adding a PAT in Options.'}
                </Typography>
              )
              : null
          )

        if(this.defaults.tabs===true) {
          outputContent.push(
            <div key={"TABBOX2"}>
              <Tabs value={this.state.tab} onChange={this.handleTabChange} aria-label="basic tabs example">
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
                {workspaceStorageHint}
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
                <button disabled={workspaceReadOnly} onClick={() => this.openRemDialog(null)} className="ButtonClearWorkspace" key={"CLEARWORKSPACECOLLECTION"}>Clear Workspace</button>
                <button onClick={() => this.openLocalMirador()} className="ButtonCopyWorkspace" key={"OPENWORKSPACEINLOCALMIRADOR"}>Local Mirador</button>
                <br key="workspace-spacer-1"/>
                <br key="workspace-spacer-2"/>
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
                  {workspaceStorageHint}
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
                  <Tooltip title="Remove all workspace items and annotations">
                    {
                      this.theme.removeAllWorkspaceImage===null ?
                      <button disabled={workspaceReadOnly} onClick={() => this.openRemDialog(null)} className="ButtonClearWorkspace" key={"CLEARWORKSPACECOLLECTION"}>Remove All</button>
                      :
                      <IconButton disabled={workspaceReadOnly} color="primary" onClick={() => this.openRemDialog(null)} className="ButtonClearWorkspace" key={"CLEARWORKSPACECOLLECTION"}>
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
                    <small className="version"></small>
                    { this.theme.logoSecondaryImageBig ? <img src={this.theme.logoSecondaryImageBig} alt={this.theme.title} className="Logo-image-Secondary-Big" /> : null }
                  </div>
        } else {
          header= <div className="App-header" key={'App-header-0'}>
                    <h2 className="App-title">{this.theme.title}<img src={this.theme.logoImage} className="Logo-image" /></h2>
                    <small className="version"></small>
                    { this.theme.logoSecondaryImageBig ? <img src={this.theme.logoSecondaryImageBig} alt={this.theme.title} className="Logo-image-Secondary-Big" /> : null }
                  </div>
        }

        return(
          <div className="App" key={"App"} aria-busy={this.state.workspaceBusy ? 'true' : 'false'}>
            {header}
            <div className="App-subheader" key={'App-subheader-0'}>
              {subHeaderContent}
              <div className="WorkspaceIcon" style={{display:(this.defaults.tabs===true?'none':'block')}}>
                <Tooltip title={this.state.tab===0 ? "Open Workspaces" : "Close Workspaces"}>
                <IconButton color="primary"
                  aria-label="Workspaces"
                  component="span"
                  onClick={ () => {
                    const nextTab = this.state.tab!==0?0:3
                    this.setState({tab: nextTab}, () => {
                      if (nextTab === 3) {
                        this.refreshGitHubWorkspaceRepositoryOptions()
                      }
                    })
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

            <Dialog
              open={this.state.openRepositoryDialogOpen}
              onClose={this.closeOpenRepositoryDialog}
              aria-labelledby="open-workspace-dialog-title"
              fullWidth
            >
              <DialogTitle id="open-workspace-dialog-title">Open shared workspace</DialogTitle>
              <DialogContent>
                <DialogContentText sx={{ mb: 2 }}>
                  Enter a GitHub repository URL or owner/repository. Public repositories can be opened without a PAT.
                </DialogContentText>
                <TextField
                  autoFocus
                  fullWidth
                  label="GitHub repository"
                  placeholder="https://github.com/owner/repository"
                  value={this.state.openRepositoryInput}
                  onChange={(event) => this.setState({ openRepositoryInput: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      this.openSharedWorkspace()
                    }
                  }}
                />
              </DialogContent>
              <DialogActions>
                <Button onClick={this.closeOpenRepositoryDialog}>Cancel</Button>
                <Button
                  onClick={this.openSharedWorkspace}
                  disabled={!this.state.openRepositoryInput.trim()}
                  startIcon={<FolderOpenOutlinedIcon />}
                >
                  Open
                </Button>
              </DialogActions>
            </Dialog>

            <Dialog
              open={this.state.shareDialogOpen}
              onClose={this.closeWorkspaceShareDialog}
              aria-labelledby="share-workspace-dialog-title"
              fullWidth
              maxWidth="sm"
            >
              <DialogTitle id="share-workspace-dialog-title">Share workspace</DialogTitle>
              <DialogContent>
                <Stack spacing={2} sx={{ pt: 0.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body1" sx={{ flexGrow: 1, overflowWrap: 'anywhere' }}>
                      {this.state.githubWorkspaceAccess?.repository || this.state.activeGitHubRepository}
                    </Typography>
                    {this.state.githubWorkspaceAccess ? (
                      <Chip
                        size="small"
                        label={this.state.githubWorkspaceAccess.private ? 'Private' : 'Public'}
                      />
                    ) : null}
                    {this.state.githubWorkspaceAccess && !this.state.githubWorkspaceAccess.canPush ? (
                      <Chip size="small" label="Read only" />
                    ) : null}
                  </Stack>

                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      fullWidth
                      label="Workspace link"
                      value={this.state.githubWorkspaceAccess?.htmlUrl || `https://github.com/${this.state.activeGitHubRepository}`}
                      slotProps={{ input: { readOnly: true } }}
                    />
                    <Tooltip title="Copy workspace link">
                      <IconButton
                        aria-label="Copy workspace link"
                        onClick={() => this.copyUrl(
                          this.state.githubWorkspaceAccess?.htmlUrl || `https://github.com/${this.state.activeGitHubRepository}`
                        )}
                      >
                        <ContentCopyOutlinedIcon />
                      </IconButton>
                    </Tooltip>
                  </Stack>

                  <FormControl fullWidth size="small">
                    <InputLabel id="workspace-visibility-label">Visibility</InputLabel>
                    <Select
                      labelId="workspace-visibility-label"
                      label="Visibility"
                      value={this.state.githubWorkspaceAccess?.private === false ? 'public' : 'private'}
                      onChange={this.changeWorkspaceVisibility}
                      disabled={!this.state.githubWorkspaceAccess?.canAdmin}
                    >
                      <MenuItem value="private">Private - invited collaborators only</MenuItem>
                      <MenuItem value="public">Public - anyone with the link can read</MenuItem>
                    </Select>
                  </FormControl>

                  <Divider />

                  {this.state.githubWorkspaceAccess?.canAdmin ? (
                    <React.Fragment>
                      <Typography variant="subtitle2">Collaborators</Typography>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <TextField
                          fullWidth
                          size="small"
                          label="GitHub username"
                          value={this.state.shareCollaboratorUsername}
                          onChange={(event) => this.setState({ shareCollaboratorUsername: event.target.value })}
                        />
                        <FormControl size="small" sx={{ minWidth: 112 }}>
                          <InputLabel id="collaborator-role-label">Role</InputLabel>
                          <Select
                            labelId="collaborator-role-label"
                            label="Role"
                            value={this.state.shareCollaboratorPermission}
                            onChange={(event) => this.setState({ shareCollaboratorPermission: event.target.value })}
                          >
                            <MenuItem
                              value="pull"
                              disabled={this.state.githubWorkspaceAccess?.ownerType === 'User'}
                            >
                              Viewer
                            </MenuItem>
                            <MenuItem value="push">Editor</MenuItem>
                          </Select>
                        </FormControl>
                        <Tooltip title="Invite collaborator">
                          <span>
                            <IconButton
                              aria-label="Invite collaborator"
                              disabled={!this.state.shareCollaboratorUsername.trim()}
                              onClick={this.addWorkspaceCollaborator}
                            >
                              <PersonAddAltOutlinedIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>

                      {this.state.githubWorkspaceAccess?.ownerType === 'User' ? (
                        <Typography variant="caption">
                          Private repositories owned by personal accounts only support collaborator write access. Use an organization repository for separate Viewer and Editor roles.
                        </Typography>
                      ) : null}

                      {this.state.shareCollaborators.length === 0 && this.state.shareInvitations.length === 0 ? (
                        <Typography variant="body2">No collaborators have been added.</Typography>
                      ) : null}

                      {this.state.shareCollaborators.map((collaborator) => (
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          key={`collaborator-${collaborator.login}`}
                        >
                          <Typography variant="body2" sx={{ flexGrow: 1 }}>
                            {collaborator.login}
                          </Typography>
                          <Chip
                            size="small"
                            label={collaborator.permissions?.push || collaborator.permissions?.admin ? 'Editor' : 'Viewer'}
                          />
                          <Tooltip title="Remove collaborator">
                            <IconButton
                              aria-label={`Remove ${collaborator.login}`}
                              size="small"
                              onClick={() => this.removeWorkspaceCollaborator(collaborator.login)}
                            >
                              <RemoveCircleOutlineIcon />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      ))}

                      {this.state.shareInvitations.map((invitation) => (
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          key={`invitation-${invitation.id}`}
                        >
                          <Typography variant="body2" sx={{ flexGrow: 1 }}>
                            {invitation.login}
                          </Typography>
                          <Chip size="small" label={`Pending ${invitation.permission === 'push' ? 'Editor' : 'Viewer'}`} />
                          <Tooltip title="Cancel invitation">
                            <IconButton
                              aria-label={`Cancel invitation for ${invitation.login}`}
                              size="small"
                              onClick={() => this.cancelWorkspaceInvitation(invitation.id, invitation.login)}
                            >
                              <RemoveCircleOutlineIcon />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      ))}
                    </React.Fragment>
                  ) : (
                    <Typography variant="body2">
                      Repository administrators can change visibility and manage collaborators.
                    </Typography>
                  )}
                </Stack>
              </DialogContent>
              <DialogActions>
                <Button onClick={this.closeWorkspaceShareDialog}>Close</Button>
              </DialogActions>
            </Dialog>

            <Backdrop
              open={this.state.workspaceBusy}
              sx={{
                backgroundColor: 'rgba(255, 255, 255, 0.72)',
                color: '#1f2933',
                zIndex: (theme) => theme.zIndex.modal + 2,
              }}
            >
              <Box
                role="status"
                aria-live="polite"
                sx={{
                  alignItems: 'center',
                  backgroundColor: 'background.paper',
                  border: '1px solid rgba(0, 0, 0, 0.12)',
                  borderRadius: '8px',
                  boxShadow: 3,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                  minWidth: 220,
                  px: 3,
                  py: 2,
                  textAlign: 'center',
                }}
              >
                <CircularProgress size={32} />
                <Typography variant="body2">
                  {this.state.workspaceBusyMessage || 'Working...'}
                </Typography>
              </Box>
            </Backdrop>

            <Dialog open={this.state.remDialog}>
              <DialogTitle id="alert-dialog-title">
                {this.state.remKey===null?"Remove all items and annotations from this workspace?":"Remove this item from the workspace?"}
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

            <Dialog
              open={this.state.workspaceErrorOpen}
              aria-labelledby="workspace-error-dialog-title"
            >
              <DialogTitle id="workspace-error-dialog-title">
                {this.state.workspaceErrorTitle || 'Workspace operation failed'}
              </DialogTitle>
              <DialogContent>
                <DialogContentText>
                  {this.state.workspaceErrorMessage}
                </DialogContentText>
              </DialogContent>
              <DialogActions>
                <Button onClick={this.closeWorkspaceError} autoFocus>OK</Button>
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
