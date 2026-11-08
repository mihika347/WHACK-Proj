// Browser-local source files. Demo results belong only to the bundled example.
const projectStorageKey = 'fastforward:project-files:v1';
let project = { files: [{ id: 'demo', name: demoRun.filename, content: demoRun.baseline.join('\n'), demo: true }], runs: [], active: 'demo', collapsed: false };
try {
  const saved = JSON.parse(localStorage.getItem(projectStorageKey));
  if (saved && Array.isArray(saved.files) && saved.files.every(f =>
    typeof f.id === 'string' && typeof f.name === 'string' && typeof f.content === 'string')) {
    project = saved;
    project.runs = Array.isArray(saved.runs) ? saved.runs.filter((run) =>
      typeof run?.name === 'string' && /^live:[0-9a-f]{32}$/.test(run.savedRun) && run.id === run.savedRun,
    ) : [];
    if (!activeProjectFile()) project.active = project.files[0]?.id ?? savedRunFiles[0]?.id;
  }
} catch { /* Keep files in memory when storage is unavailable. */ }

function saveProject() {
  try {
    localStorage.setItem(projectStorageKey, JSON.stringify(project));
    document.getElementById('file-status').textContent = 'Saved in this browser';
  } catch {
    document.getElementById('file-status').textContent = 'Browser storage unavailable or full. Changes remain only until this page closes.';
  }
}

function validFileName(name, exceptId) {
  if (!name || name.length > 100 || /[\\/<>:"|?*\u0000-\u001f]/.test(name) || /^\.+$/.test(name)) {
    throw new Error('Enter a file name of up to 100 characters without path separators or special characters.');
  }
  if (project.files.some(f => f.id !== exceptId && f.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('A file with that name already exists.');
  }
  return name;
}

function renderFileList() {
  const files = [...project.files, ...savedRunFiles, ...project.runs];
  const dropdown = document.getElementById('header-file-select');
  dropdown.replaceChildren();
  dropdown.disabled = !files.length;
  if (!files.length) {
    const option = document.createElement('option');
    option.textContent = 'No files';
    dropdown.append(option);
  }
  for (const file of files) {
    const option = document.createElement('option');
    option.value = file.id;
    option.textContent = file.name;
    option.selected = file.id === project.active;
    dropdown.append(option);
  }
  const list = document.getElementById('project-files');
  list.replaceChildren();
  document.querySelector('.shell').classList.toggle('files-collapsed', !!project.collapsed);
  document.getElementById('file-panel-content').hidden = !!project.collapsed;
  document.getElementById('toggle-files').setAttribute('aria-expanded', String(!project.collapsed));
  for (const file of files) {
    const item = document.createElement('li');
    const select = document.createElement('button');
    select.className = 'file-select';
    select.textContent = file.name;
    select.title = file.name;
    if (file.id === project.active) select.setAttribute('aria-current', 'true');
    select.onclick = () => selectProjectFile(file.id);
    item.append(select);
    for (const action of file.savedRun ? [] : ['Rename', 'Delete']) {
      const button = document.createElement('button');
      button.className = 'file-action';
      button.textContent = action === 'Rename' ? '✎' : '×';
      button.title = `${action} ${file.name}`;
      button.setAttribute('aria-label', button.title);
      button.onclick = () => {
        if (action === 'Rename') {
          const name = window.prompt('Rename file', file.name);
          if (name === null) return;
          try { file.name = validFileName(name.trim(), file.id); }
          catch (error) { document.getElementById('file-status').textContent = error.message; return; }
        } else {
          if (!window.confirm(`Delete ${file.name} from this workspace?`)) return;
          project.files = project.files.filter(f => f.id !== file.id);
          if (project.active === file.id) project.active = project.files[0]?.id ?? savedRunFiles[0]?.id;
        }
        saveProject(); render();
      };
      item.append(button);
    }
    list.append(item);
  }
}

function addProjectFile(name, content) {
  validFileName(name);
  const file = { id: crypto.randomUUID(), name, content };
  project.files.push(file);
  project.active = file.id;
  saveProject(); location.hash = '#pipeline'; render();
}

function addProjectRun(job, source, destination = '#pipeline') {
  const id = `live:${job.id}`;
  project.runs.push({ id, name: `Run · ${job.filename} · ${job.id.slice(0, 8)}`, savedRun: id });
  const stayWithRun = activeProjectFile() === source;
  if (stayWithRun) {
    project.active = id;
    location.hash = destination;
  }
  saveProject();
  render(stayWithRun);
}

function renderProjectFile(focusHeading) {
  const file = activeProjectFile();
  if (file?.demo) {
    document.querySelector('.demo-badge').hidden = false;
    document.getElementById('home-title').textContent = 'Optimisation pipeline';
    demoRun.filename = file.name;
    displayedCode = undefined;
    return false;
  }
  document.querySelector('.demo-badge').hidden = true;
  if (file?.savedRun) {
    document.getElementById('home-title').textContent = 'Optimisation pipeline';
    loadSavedRun(file);
    return false;
  }
  document.getElementById('final-improvement').hidden = true;
  displayedCode = undefined;
  if (!file) {
    document.getElementById('pipeline-home').hidden = true;
    document.getElementById('workspace').hidden = false;
    setSplitLayout('details-only');
    document.getElementById('workspace-stages').replaceChildren();
    document.getElementById('details-content').innerHTML = '<h2 id="view-title" tabindex="-1">No files</h2><p>Add or import a file using the Files panel.</p>';
    return true;
  }
  const state = readRoute();
  const atHome = state.view === 'pipeline';
  const atTests = state.view === 'tests';
  document.getElementById('pipeline-home').hidden = !atHome;
  document.getElementById('workspace').hidden = atHome;
  setSplitLayout(atTests ? 'details-only' : 'split');
  renderNavigation(state);
  renderPipeline(state);
  const name = escapeHtml(file.name);
  document.getElementById('run-summary').innerHTML = `<p class="eyebrow">Source file</p><h2>${name}</h2>${runSourceControl(file)}`;
  document.getElementById('home-title').textContent = `Optimisation pipeline · ${file.name}`;
  document.getElementById('source-file').textContent = file.name;
  document.querySelector('.code-header .label').textContent = file.name.endsWith('.py') ? 'Python' : 'Source';
  const editor = document.getElementById('file-editor');
  const editing = state.stage === 'original';
  editor.hidden = !editing;
  editor.value = file.content;
  document.getElementById('source-diff').hidden = editing;
  document.getElementById('source-diff').innerHTML = state.stage === 'final' ? '' : file.content.split('\n').map((line,i) => codeRow(line, i+1, '')).join('');
  document.getElementById('diff-toolbar').textContent = state.stage === 'final' ? 'No final code available' : editing ? 'Source editor' : 'Original source · awaiting optimisation';
  document.getElementById('code-footer').textContent = file.name;
  const messages = {
    original: ['Baseline source', 'Edit the source for this file. Changes are saved in this browser.'],
    generated: ['AI generated changes', 'No changes have been generated for this file yet.'],
    correctness: ['Correctness check', 'No correctness results for this file yet.'],
    performance: ['Performance evaluation', 'No benchmarks have been measured for this file yet.'],
    value: ['Value assessment', 'No proposed changes to assess yet.'],
    human: ['Human review', 'No recommended changes to approve for this file yet.'],
    final: ['Final code', 'No final code has been generated for this file yet.'],
  };
  const [title, message] = messages[state.stage] ?? ['Test cases', 'Upload test cases for this file.'];
  document.getElementById('details-content').innerHTML = `${detailHeader(state.stage ?? 'original', title, message)}
    ${editing ? runSourceControl(file) : ''}${atTests ? projectTestCasesView(file) : ''}`;
  document.getElementById('build-status').textContent = '';
  if (focusHeading) document.getElementById(atHome ? 'home-title' : 'view-title').focus();
  return true;
}

function activeProjectFile() {
  return project.files.find(file => file.id === project.active) ??
    savedRunFiles.find(file => file.id === project.active) ?? project.runs.find(file => file.id === project.active);
}

function selectProjectFile(id) {
  if (id === project.active) return;
  project.active = id;
  displayedCode = undefined;
  saveProject();
  render(true);
}

function projectTestCasesView(file) {
  const suites = file.testSuites ?? [];
  const count = suites.reduce((total, suite) => total + suite.cases.length, 0);
  return `<section class="inset test-upload-box"><h2>Upload your own test cases</h2>
    <label class="button primary" for="project-tests">${icon('upload')} Upload test cases</label>
    <input id="project-tests" type="file" accept=".json,application/json" class="visually-hidden">
    <p id="project-test-status" role="status"></p>
    </section><p>${count} uploaded cases. They will run with the next optimisation of this file.</p>
    ${suites.map((suite) => `<section class="test-suite"><h3 class="test-suite-header">${escapeHtml(suite.name)}</h3>
      <pre class="project-test-json">${escapeHtml(suite.text ?? JSON.stringify(suite.cases, null, 2))}</pre></section>`).join('')}`;
}

document.getElementById('details-content').addEventListener('change', async event => {
  if (event.target.id !== 'project-tests' || !event.target.files[0]) return;
  const target = activeProjectFile();
  const upload = event.target.files[0];
  event.target.value = '';
  try {
    if (upload.size > 1024 * 1024) throw Error('Maximum upload size is 1 MB.');
    const text = await upload.text();
    const cases = parseTestCases(text);
    if (!project.files.includes(target)) return;
    (target.testSuites ??= []).push({name: upload.name, cases, text});
    saveProject();
    if (activeProjectFile() === target) render();
  } catch (error) {
    const status = activeProjectFile() === target && document.getElementById('project-test-status');
    if (status) status.textContent = error.message;
  }
});

document.getElementById('header-file-select').onchange = event => {
  selectProjectFile(event.target.value);
};

document.getElementById('toggle-files').onclick = () => {
  project.collapsed = !project.collapsed; saveProject(); renderFileList();
};
document.getElementById('new-file-form').onsubmit = event => {
  event.preventDefault();
  const input = document.getElementById('new-file-name');
  try { addProjectFile(input.value.trim(), ''); input.value = ''; }
  catch (error) { document.getElementById('file-status').textContent = error.message; }
};
document.getElementById('import-files-button').onclick = () => document.getElementById('import-files').click();
document.getElementById('import-files').onchange = async event => {
  const errors = [];
  for (const file of event.target.files) {
    try {
      if (file.size > 1024 * 1024) throw new Error(`${file.name}: maximum file size is 1 MB.`);
      addProjectFile(file.name, await file.text());
    } catch (error) { errors.push(error.message); }
  }
  event.target.value = '';
  if (errors.length) document.getElementById('file-status').textContent = errors.join(' ');
};
document.getElementById('file-editor').oninput = event => {
  const file = project.files.find(f => f.id === project.active);
  if (file && !file.demo) { file.content = event.target.value; saveProject(); }
};
