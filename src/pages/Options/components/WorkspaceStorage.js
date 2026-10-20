import React, { Component } from 'react'

import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import ExpandMoreIcon from '@mui/icons-material/ExpandMore'

import {
  loadAnnotationUserSettings,
  saveAnnotationUserSettings,
} from '../../../shared/annotationUser'
import {
  WORKSPACE_STORAGE_BACKENDS,
  loadWorkspaceStorageSettings,
  saveWorkspaceStorageSettings,
} from '../../../shared/storage/storageSettings'

class WorkspaceStorage extends Component {
  constructor(props) {
    super(props)

    this.state = {
      annotationDisplayName: '',
      saving: false,
      settings: null,
      status: '',
      statusSeverity: 'info',
    }

    this.loadSettings = this.loadSettings.bind(this)
    this.saveSettings = this.saveSettings.bind(this)
    this.setBackend = this.setBackend.bind(this)
    this.setGitHubToken = this.setGitHubToken.bind(this)
  }

  componentDidMount() {
    this.loadSettings()
  }

  async loadSettings() {
    try {
      const [settings, annotationUserSettings] = await Promise.all([
        loadWorkspaceStorageSettings(),
        loadAnnotationUserSettings(),
      ])

      this.setState({
        annotationDisplayName: annotationUserSettings.displayName,
        settings,
      })
    } catch (error) {
      this.setStatus(`Storage settings could not be loaded: ${error.message || error}`, 'error')
    }
  }

  setStatus(status, statusSeverity = 'info') {
    this.setState({ status, statusSeverity })
  }

  setBackend(event) {
    this.setState({
      settings: {
        ...this.state.settings,
        backend: event.target.value,
      },
    })
  }

  setGitHubToken(value) {
    this.setState({
      settings: {
        ...this.state.settings,
        github: {
          ...this.state.settings.github,
          token: value,
        },
      },
    })
  }

  async saveSettings() {
    this.setState({ saving: true })

    try {
      const [settings] = await Promise.all([
        saveWorkspaceStorageSettings(this.state.settings),
        saveAnnotationUserSettings({
          displayName: this.state.annotationDisplayName,
        }),
      ])

      this.setState({ settings })
      this.setStatus('Workspace storage settings saved.', 'success')
    } catch (error) {
      this.setStatus(`Workspace storage settings could not be saved: ${error.message || error}`, 'error')
    } finally {
      this.setState({ saving: false })
    }
  }

  renderGitHubSettings() {
    const github = this.state.settings.github

    return (
      <Stack spacing={2} sx={{ marginTop: 2 }}>
        <TextField
          helperText="Optional for public read-only workspaces; required for private repositories and all changes."
          label="Personal access token"
          onChange={(event) => this.setGitHubToken(event.target.value)}
          size="small"
          type="password"
          value={github.token}
        />
        <Typography variant="body2">
          The PAT is stored in local extension storage only. GitHub workspaces are opened, selected, created, shared, renamed and deleted in the popup Workspaces tab.
        </Typography>
      </Stack>
    )
  }

  render() {
    const settings = this.state.settings

    if (!settings) {
      return null
    }

    return (
      <Accordion style={{ border: '0', boxShadow: 'none', margin: '12px 0' }} disableGutters={true} defaultExpanded={true}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} style={{ backgroundColor: '#fff', padding: '0 0', border: '0' }} >
          <h2>Workspace Storage</h2>
        </AccordionSummary>
        <AccordionDetails style={{ padding: '0' }}>
          <Stack spacing={2}>
            <FormControl size="small" fullWidth>
              <InputLabel id="workspace-storage-backend-label">Storage Backend</InputLabel>
              <Select
                label="Storage Backend"
                labelId="workspace-storage-backend-label"
                onChange={this.setBackend}
                value={settings.backend}
              >
                <MenuItem value={WORKSPACE_STORAGE_BACKENDS.BROWSER_SYNC}>Browser Sync</MenuItem>
                <MenuItem value={WORKSPACE_STORAGE_BACKENDS.GITHUB}>GitHub Storage</MenuItem>
              </Select>
            </FormControl>

            <TextField
              helperText="Used as annotation creator/editor name for Browser Sync and as fallback when GitHub user lookup is unavailable."
              label="Annotation display name"
              onChange={(event) => this.setState({ annotationDisplayName: event.target.value })}
              placeholder="detektIIIF User"
              size="small"
              value={this.state.annotationDisplayName}
            />

            {settings.backend === WORKSPACE_STORAGE_BACKENDS.BROWSER_SYNC ? (
              <Typography variant="body2">
                Workspaces and annotations are stored in browser sync storage.
              </Typography>
            ) : null}

            {settings.backend === WORKSPACE_STORAGE_BACKENDS.GITHUB
              ? this.renderGitHubSettings()
              : null}

            {this.state.status ? (
              <Alert severity={this.state.statusSeverity}>{this.state.status}</Alert>
            ) : null}

            <Box>
              <Button
                disabled={this.state.saving}
                onClick={this.saveSettings}
                size="small"
                variant="contained"
              >
                Save Storage Settings
              </Button>
            </Box>
          </Stack>
        </AccordionDetails>
      </Accordion>
    )
  }
}

export default WorkspaceStorage
