(function () {
  var input = document.getElementById('lu-file-input');
  var pickBtn = document.getElementById('lu-pick-files');
  var addMoreBtn = document.getElementById('lu-add-more-files');
  var emptyState = document.getElementById('lu-picker-empty');
  var filledState = document.getElementById('lu-picker-filled');
  var clearAllBtn = document.getElementById('lu-clear-all');
  var fileCount = document.getElementById('lu-file-count');
  var selectionTitle = document.getElementById('lu-selection-title');
  var list = document.getElementById('lu-file-list');
  if (!input || !emptyState || !filledState || !list) return;

  var preservedFiles = [];

  var ICONS = {
    remove:
      '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>',
    file:
      '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
  };

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function fileExtension(name) {
    var i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toUpperCase() : '';
  }

  function fileListArray() {
    return input.files ? Array.prototype.slice.call(input.files) : [];
  }

  function setFiles(files) {
    var dt = new DataTransfer();
    files.forEach(function (file) {
      dt.items.add(file);
    });
    input.files = dt.files;
    render();
  }

  function mergeFiles(existing, incoming) {
    var merged = existing.slice();
    var names = {};
    merged.forEach(function (file) {
      names[file.name] = true;
    });
    incoming.forEach(function (file) {
      if (!names[file.name]) {
        merged.push(file);
        names[file.name] = true;
      }
    });
    return merged;
  }

  function togglePicker(hasFiles) {
    emptyState.classList.toggle('hidden', hasFiles);
    filledState.classList.toggle('hidden', !hasFiles);
  }

  function buildFileRow(file, index) {
    var item = document.createElement('li');
    item.className = 'lu-file-item';

    var icon = document.createElement('span');
    icon.className = 'lu-file-item__icon';
    icon.innerHTML = ICONS.file;

    var body = document.createElement('div');
    body.className = 'lu-file-item__body';

    var nameRow = document.createElement('div');
    nameRow.className = 'lu-file-item__name-row';

    var name = document.createElement('span');
    name.className = 'lu-file-item__name';
    name.textContent = file.name;
    nameRow.appendChild(name);

    var ext = fileExtension(file.name);
    if (ext) {
      var extBadge = document.createElement('span');
      extBadge.className = 'lu-file-item__ext';
      extBadge.textContent = ext;
      nameRow.appendChild(extBadge);
    }

    var meta = document.createElement('span');
    meta.className = 'lu-file-item__meta';
    meta.textContent = formatSize(file.size);

    body.appendChild(nameRow);
    body.appendChild(meta);

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'lu-file-item__remove';
    removeBtn.innerHTML = ICONS.remove;
    removeBtn.setAttribute('aria-label', 'Remove ' + file.name);
    removeBtn.addEventListener('click', function () {
      var next = fileListArray();
      next.splice(index, 1);
      setFiles(next);
    });

    item.appendChild(icon);
    item.appendChild(body);
    item.appendChild(removeBtn);
    return item;
  }

  function render() {
    var files = fileListArray();
    list.innerHTML = '';
    togglePicker(files.length > 0);

    if (!files.length) {
      return;
    }

    fileCount.textContent = String(files.length);
    selectionTitle.textContent = files.length === 1 ? 'File selected' : 'Files selected';

    files.forEach(function (file, index) {
      list.appendChild(buildFileRow(file, index));
    });
  }

  function openFileDialog(merge) {
    preservedFiles = merge ? fileListArray() : [];
    input.click();
  }

  if (pickBtn) {
    pickBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openFileDialog(false);
    });
  }

  if (addMoreBtn) {
    addMoreBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      openFileDialog(true);
    });
  }

  if (emptyState) {
    emptyState.addEventListener('click', function (event) {
      if (event.target.closest('#lu-pick-files, .lu-dropzone__link')) {
        return;
      }
      openFileDialog(false);
    });
    emptyState.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFileDialog(false);
      }
    });
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', function () {
      input.value = '';
      setFiles([]);
    });
  }

  function preventDefaults(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function setDragState(active) {
    if (!emptyState || emptyState.classList.contains('hidden')) {
      return;
    }
    emptyState.classList.toggle('is-dragover', active);
  }

  ['dragenter', 'dragover'].forEach(function (eventName) {
    document.addEventListener(eventName, function (event) {
      if (!emptyState || emptyState.classList.contains('hidden')) {
        return;
      }
      preventDefaults(event);
      setDragState(true);
    });
  });

  ['dragleave', 'drop'].forEach(function (eventName) {
    document.addEventListener(eventName, function (event) {
      if (!emptyState || emptyState.classList.contains('hidden')) {
        return;
      }
      preventDefaults(event);
      setDragState(false);
    });
  });

  document.addEventListener('drop', function (event) {
    if (!emptyState || emptyState.classList.contains('hidden')) {
      return;
    }
    var dropped = event.dataTransfer && event.dataTransfer.files;
    if (!dropped || !dropped.length) {
      return;
    }
    setFiles(Array.prototype.slice.call(dropped));
  });

  input.addEventListener('change', function () {
    var incoming = Array.prototype.slice.call(input.files || []);
    if (!incoming.length) {
      render();
      return;
    }
    if (preservedFiles.length) {
      setFiles(mergeFiles(preservedFiles, incoming));
      preservedFiles = [];
      return;
    }
    setFiles(incoming);
  });

  render();
})();
