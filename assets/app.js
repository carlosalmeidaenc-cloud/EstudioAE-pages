(async function () {
  const root = document.getElementById("app");
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let manifest = null;
  let publicManifest = null;
  let view = { screen: "home", module: "", groupId: "" };
  let viewer = { open: false, module: "", groupId: "", index: 0 };
  let viewerRenderId = 0;
  const VIEWER_MIN_ZOOM = 1;
  const VIEWER_MAX_ZOOM = 5;
  const VIEWER_ZOOM_STEP = 0.5;
  const cryptoState = {
    encrypted: false,
    key: null,
    mediaCache: new Map()
  };

  function text(value) {
    return String(value == null ? "" : value);
  }

  function html(value) {
    return text(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function clear() {
    root.innerHTML = "";
  }

  function button(className, label, onClick) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = className;
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  }

  function base64UrlToBytes(value) {
    let input = text(value).replace(/-/g, "+").replace(/_/g, "/");
    while (input.length % 4) input += "=";
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function hashParam(name) {
    const raw = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    return params.get(name) || "";
  }

  async function importAesKey(rawKey) {
    return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  }

  async function derivePasswordKey(password, salt, iterations) {
    const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function decryptBytes(buffer, key) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 29) throw new Error("arquivo criptografado invalido");
    const iv = bytes.slice(0, 12);
    const payload = bytes.slice(12);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload);
  }

  async function decryptJson(manifestInfo, key) {
    const response = await fetch(manifestInfo.manifestPath || "manifest.enc", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const plain = await decryptBytes(await response.arrayBuffer(), key);
    return JSON.parse(decoder.decode(plain));
  }

  function renderTopbar() {
    const topbar = document.createElement("header");
    topbar.className = "topbar";
    const subtitle = manifest && manifest.kind === "engineer-index"
      ? "Área técnica"
      : manifest ? manifest.clientName : "Área protegida";
    topbar.innerHTML = `
      <div class="brand">
        <div class="brand-mark">AE</div>
        <div>
          <p class="brand-title">Estúdio AE</p>
          <p class="brand-subtitle">${html(subtitle)}</p>
        </div>
      </div>
    `;
    return topbar;
  }

  function designGroups() {
    const module = manifest.modules.interiores || {};
    if (Array.isArray(module.groups)) {
      return module.groups.map((group) => ({
        ...group,
        groupTitle: group.name,
        media: group.media || []
      }));
    }
    return (module.environments || []).map((environment) => ({
      ...environment,
      groupTitle: environment.name,
      media: environment.images || []
    }));
  }

  function obraGroups() {
    const module = manifest.modules.obra || {};
    if (Array.isArray(module.groups)) {
      return module.groups.map((group) => ({
        ...group,
        groupTitle: group.name,
        media: group.media || []
      }));
    }
    return (module.stages || []).map((stage) => ({
      ...stage,
      groupTitle: stage.label,
      media: stage.photos || []
    }));
  }

  function rawGroupsForModule(moduleName) {
    return moduleName === "obra" ? obraGroups() : designGroups();
  }

  function moduleCounts() {
    const design = designGroups();
    const obra = obraGroups();
    return {
      designGroups: design.length,
      designMedia: design.reduce((sum, entry) => sum + entry.media.length, 0),
      obraGroups: obra.length,
      obraMedia: obra.reduce((sum, entry) => sum + entry.media.length, 0)
    };
  }

  function renderHome() {
    clear();
    root.appendChild(renderTopbar());

    const counts = moduleCounts();
    const hero = document.createElement("section");
    hero.className = "hero";
    hero.innerHTML = `
      <div class="welcome">
        <h1>Olá, ${html(manifest.clientName)}</h1>
        <p>Apenas você tem acesso a essa página, pois ela possui um link único. Escolha abaixo se deseja acessar OBRA ou DESIGN DE INTERIORES.</p>
      </div>
    `;

    const grid = document.createElement("div");
    grid.className = "module-grid";

    const obra = button("module-card", "", () => {
      view = { screen: "module", module: "obra", groupId: "" };
      renderModule();
    });
    obra.innerHTML = `<strong>OBRA</strong><span>${html(countLabel(counts.obraGroups, "etapa", "etapas"))} / ${html(countLabel(counts.obraMedia, "foto", "fotos"))}</span>`;
    grid.appendChild(obra);

    const design = button("module-card", "", () => {
      view = { screen: "module", module: "interiores", groupId: "" };
      renderModule();
    });
    const designPlural = manifest.kind === "engineer" ? "arquivos" : "imagens";
    const designSingular = manifest.kind === "engineer" ? "arquivo" : "imagem";
    design.innerHTML = `<strong>DESIGN DE INTERIORES</strong><span>${html(countLabel(counts.designGroups, "grupo", "grupos"))} / ${html(countLabel(counts.designMedia, designSingular, designPlural))}</span>`;
    grid.appendChild(design);

    hero.appendChild(grid);
    root.appendChild(hero);
  }

  function renderEngineerIndex() {
    clear();
    root.appendChild(renderTopbar());

    const clients = Array.isArray(manifest.clients) ? manifest.clients : [];
    const hero = document.createElement("section");
    hero.className = "hero";
    hero.innerHTML = `
      <div class="welcome">
        <h1>Clientes</h1>
        <p>Selecione o cliente para abrir a área técnica protegida.</p>
      </div>
    `;
    root.appendChild(hero);

    if (!clients.length) {
      renderEmpty("Nenhum cliente publicado no GitPages tecnico.");
      return;
    }

    const grid = document.createElement("section");
    grid.className = "folder-grid";
    for (const client of clients) {
      const card = button("folder-card", "", () => {
        window.location.href = client.path || client.url || "#";
      });
      const updated = client.updatedAt ? `Atualizado em ${new Date(client.updatedAt).toLocaleDateString("pt-BR")}` : "Área técnica";
      card.innerHTML = `<strong>${html(client.name || client.id || "Cliente")}</strong><span>${html(updated)}</span>`;
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  function groupsForCurrentModule() {
    const singular = view.module === "obra" ? "foto" : manifest.kind === "engineer" ? "arquivo" : "imagem";
    const plural = view.module === "obra" ? "fotos" : manifest.kind === "engineer" ? "arquivos" : "imagens";
    return rawGroupsForModule(view.module).map((group) => ({
      id: group.id,
      title: group.groupTitle || group.name || group.label,
      count: group.media.length,
      countSingular: singular,
      countPlural: plural
    }));
  }

  function moduleTitle() {
    return view.module === "obra" ? "OBRA" : "DESIGN DE INTERIORES";
  }

  function renderTopbar() {
    const topbar = document.createElement("header");
    topbar.className = "topbar";
    let subtitle = "Area protegida";
    if (manifest && manifest.kind === "engineer-index") subtitle = "Area tecnica";
    else if (manifest && manifest.kind === "executor") subtitle = "Execução";
    else if (manifest) subtitle = manifest.clientName;
    topbar.innerHTML = `
      <div class="brand">
        <div class="brand-mark">AE</div>
        <div>
          <p class="brand-title">Estudio AE</p>
          <p class="brand-subtitle">${html(subtitle)}</p>
        </div>
      </div>
    `;
    return topbar;
  }

  function normalizeModuleGroups(module) {
    if (!module || typeof module !== "object") return [];
    if (Array.isArray(module.groups)) {
      return module.groups.map((group) => ({
        ...group,
        groupTitle: group.name,
        media: group.media || []
      }));
    }
    if (Array.isArray(module.environments)) {
      return module.environments.map((environment) => ({
        ...environment,
        groupTitle: environment.name,
        media: environment.images || []
      }));
    }
    if (Array.isArray(module.stages)) {
      return module.stages.map((stage) => ({
        ...stage,
        groupTitle: stage.label,
        media: stage.photos || []
      }));
    }
    return [];
  }

  function moduleOrder() {
    if (Array.isArray(manifest.moduleOrder) && manifest.moduleOrder.length) {
      return manifest.moduleOrder.filter((name) => manifest.modules && manifest.modules[name]);
    }
    if (manifest.modules && manifest.kind === "executor") return Object.keys(manifest.modules);
    return ["obra", "interiores", "arquitetonico"].filter((name) => manifest.modules && manifest.modules[name]);
  }

  function defaultModuleLabel(moduleName) {
    if (moduleName === "obra") return "OBRA";
    if (moduleName === "arquitetonico") return "ARQUITETONICO";
    return "DESIGN DE INTERIORES";
  }

  function defaultModuleDescription(moduleName) {
    if (moduleName === "obra") return "Etapas com fotos registradas.";
    if (moduleName === "arquitetonico") return "Pranchas, fachadas e refer\u00eancias publicadas para consulta.";
    return "Grupos disponiveis para consulta.";
  }

  function moduleEntry(moduleName) {
    const module = manifest.modules && manifest.modules[moduleName] ? manifest.modules[moduleName] : {};
    const groups = normalizeModuleGroups(module);
    const mediaCount = groups.reduce((sum, entry) => sum + entry.media.length, 0);
    const clientLike = manifest.kind === "client" || manifest.kind === "client-preview";
    return {
      id: moduleName,
      label: module.label || defaultModuleLabel(moduleName),
      description: module.description || defaultModuleDescription(moduleName),
      groupSingular: module.groupSingular || (moduleName === "obra" ? "etapa" : moduleName === "arquitetonico" ? "pasta" : "grupo"),
      groupPlural: module.groupPlural || (moduleName === "obra" ? "etapas" : moduleName === "arquitetonico" ? "pastas" : "grupos"),
      itemSingular: module.itemSingular || (moduleName === "obra" ? "foto" : clientLike ? "imagem" : "arquivo"),
      itemPlural: module.itemPlural || (moduleName === "obra" ? "fotos" : clientLike ? "imagens" : "arquivos"),
      directMedia: Boolean(module.directMedia),
      groups,
      mediaCount
    };
  }

  function rawGroupsForModule(moduleName) {
    return moduleEntry(moduleName).groups;
  }

  function homeText() {
    if (manifest.kind === "executor") {
      return "Arquivos técnicos liberados para execução. Escolha a disciplina para consultar as pastas publicadas.";
    }
    return "Apenas voce tem acesso a essa pagina, pois ela possui um link unico. Escolha abaixo o que deseja acessar.";
  }

  function renderHome() {
    clear();
    root.appendChild(renderTopbar());

    const hero = document.createElement("section");
    hero.className = "hero";
    hero.innerHTML = `
      <div class="welcome">
        <h1>${manifest.kind === "executor" ? "Execução" : `Ola, ${html(manifest.clientName)}`}</h1>
        <p>${html(homeText())}</p>
      </div>
    `;

    const grid = document.createElement("div");
    grid.className = "module-grid";

    for (const moduleName of moduleOrder()) {
      const entry = moduleEntry(moduleName);
      const card = button("module-card", "", () => {
        view = { screen: "module", module: moduleName, groupId: "" };
        renderModule();
      });
      card.innerHTML = `<strong>${html(entry.label)}</strong><span>${html(countLabel(entry.groups.length, entry.groupSingular, entry.groupPlural))} / ${html(countLabel(entry.mediaCount, entry.itemSingular, entry.itemPlural))}</span>`;
      grid.appendChild(card);
    }

    hero.appendChild(grid);
    root.appendChild(hero);
  }

  function groupsForCurrentModule() {
    const entry = moduleEntry(view.module);
    return rawGroupsForModule(view.module).map((group) => ({
      id: group.id,
      title: group.groupTitle || group.name || group.label,
      count: group.media.length,
      countSingular: entry.itemSingular,
      countPlural: entry.itemPlural
    }));
  }

  function moduleTitle() {
    return moduleEntry(view.module).label;
  }

  function renderModule() {
    clear();
    root.appendChild(renderTopbar());

    const head = document.createElement("section");
    head.className = "section-head";
    const subtitle = moduleEntry(view.module).description;
    head.innerHTML = `<div><h1>${html(moduleTitle())}</h1><p>${html(subtitle)}</p></div>`;
    head.appendChild(button("back-button", "Voltar", () => {
      view = { screen: "home", module: "", groupId: "" };
      renderHome();
    }));
    root.appendChild(head);

    const entry = moduleEntry(view.module);
    const groups = groupsForCurrentModule();
    if (!groups.length) {
      renderEmpty(view.module === "obra" ? "Nenhuma foto de obra disponivel." : "Nenhum arquivo disponivel.");
      return;
    }

    if (entry.directMedia && groups.length === 1) {
      view = { screen: "group", module: view.module, groupId: groups[0].id };
      renderGroup();
      return;
    }

    const grid = document.createElement("section");
    grid.className = "folder-grid";
    for (const group of groups) {
      const card = button("folder-card", "", () => openGroup(group.id));
      card.innerHTML = `<strong>${html(group.title)}</strong><span>${html(countLabel(group.count, group.countSingular, group.countPlural))}</span>`;
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  function selectedGroup() {
    return rawGroupsForModule(view.module).find((group) => group.id === view.groupId) || null;
  }

  function mediaForGroup(group) {
    return group ? group.media || [] : [];
  }

  function shouldOpenGroupInViewer(group) {
    const media = mediaForGroup(group);
    if (!media.length) return false;
    if (manifest.kind === "executor") return true;
    if (manifest.kind === "engineer" && view.module === "interiores" && group.bucket === "PDF") return false;
    return media.some(isImageItem);
  }

  function firstImageIndex(group) {
    const media = mediaForGroup(group);
    const imageIndex = media.findIndex(isImageItem);
    return imageIndex >= 0 ? imageIndex : 0;
  }

  function openGroup(groupId) {
    view = { screen: "group", module: view.module, groupId };
    const group = selectedGroup();
    if (shouldOpenGroupInViewer(group)) {
      openViewer(firstImageIndex(group));
      return;
    }
    renderGroup();
  }

  function currentViewerGroup() {
    return rawGroupsForModule(viewer.module).find((group) => group.id === viewer.groupId) || null;
  }

  function currentViewerMedia() {
    const group = currentViewerGroup();
    return group ? group.media : [];
  }

  function clampViewerIndex() {
    const media = currentViewerMedia();
    if (!media.length) {
      viewer.index = 0;
      return;
    }
    if (viewer.index < 0) viewer.index = media.length - 1;
    if (viewer.index >= media.length) viewer.index = 0;
  }

  function isImageItem(item) {
    return item && (item.type === "image" || /^image\//.test(item.mime || ""));
  }

  function isPdfItem(item) {
    return item && (
      item.type === "pdf" ||
      item.ext === ".pdf" ||
      item.mime === "application/pdf" ||
      /\.pdf$/i.test(item.fileName || "")
    );
  }

  function isZoomableItem(item) {
    return isImageItem(item) || isPdfItem(item);
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  async function mediaUrl(item) {
    if (!item || !item.mediaPath) throw new Error("midia sem caminho");
    if (!cryptoState.encrypted) return item.mediaPath;
    if (cryptoState.mediaCache.has(item.mediaPath)) return cryptoState.mediaCache.get(item.mediaPath);
    const response = await fetch(item.mediaPath, { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const plain = await decryptBytes(await response.arrayBuffer(), cryptoState.key);
    const blob = new Blob([plain], { type: item.mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    cryptoState.mediaCache.set(item.mediaPath, url);
    return url;
  }

  function preloadViewerNeighbors() {
    const media = currentViewerMedia();
    if (media.length < 2) return;
    const candidates = [
      media[(viewer.index + 1) % media.length],
      media[(viewer.index - 1 + media.length) % media.length]
    ];
    for (const item of candidates) {
      if (!item || !isImageItem(item)) continue;
      mediaUrl(item).then((url) => {
        const img = new Image();
        img.src = url;
      }).catch(() => {});
    }
  }

  function openViewer(index) {
    viewer = { open: true, module: view.module, groupId: view.groupId, index };
    clampViewerIndex();
    document.body.classList.add("viewer-open");
    renderViewer();
  }

  function closeViewer() {
    viewer.open = false;
    document.body.classList.remove("viewer-open");
    const overlay = document.querySelector("[data-viewer-overlay]");
    if (overlay) overlay.remove();
  }

  function returnToPreviousPageFromViewer() {
    closeViewer();
  }

  function moveViewerImage(delta) {
    if (!viewer.open) return;
    viewer.index += delta;
    clampViewerIndex();
    renderViewer();
  }

  function moveViewerGroup(delta) {
    if (!viewer.open) return;
    const groups = rawGroupsForModule(viewer.module).filter((group) => group.media.length);
    if (groups.length < 2) return;
    const currentIndex = Math.max(0, groups.findIndex((group) => group.id === viewer.groupId));
    const nextIndex = (currentIndex + delta + groups.length) % groups.length;
    viewer.groupId = groups[nextIndex].id;
    viewer.index = 0;
    clampViewerIndex();
    renderViewer();
  }

  function renderViewerDots(media) {
    const dots = document.createElement("div");
    dots.className = "viewer-dots";
    media.forEach((item, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "viewer-dot";
      dot.setAttribute("aria-label", `Item ${index + 1}`);
      dot.setAttribute("aria-current", String(index === viewer.index));
      dot.addEventListener("click", () => {
        viewer.index = index;
        renderViewer();
      });
      dots.appendChild(dot);
    });
    return dots;
  }

  function createViewerZoom(stage, content) {
    const state = {
      scale: VIEWER_MIN_ZOOM,
      x: 0,
      y: 0,
      isZoomed() {
        return this.scale > VIEWER_MIN_ZOOM + 0.01;
      },
      apply() {
        if (!this.isZoomed()) {
          this.x = 0;
          this.y = 0;
        }
        content.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) scale(${this.scale})`;
        content.classList.toggle("is-zoomed", this.isZoomed());
        stage.classList.toggle("is-zoomed", this.isZoomed());
      },
      setScale(value) {
        this.scale = clampNumber(value, VIEWER_MIN_ZOOM, VIEWER_MAX_ZOOM);
        this.apply();
      },
      panBy(deltaX, deltaY) {
        if (!this.isZoomed()) return;
        this.x += deltaX;
        this.y += deltaY;
        this.apply();
      }
    };

    content.addEventListener("dblclick", (event) => {
      event.preventDefault();
      state.setScale(state.isZoomed() ? VIEWER_MIN_ZOOM : 2);
    });
    stage.addEventListener("wheel", (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      state.setScale(state.scale + (event.deltaY > 0 ? -VIEWER_ZOOM_STEP : VIEWER_ZOOM_STEP));
    }, { passive: false });
    state.apply();
    return state;
  }

  async function downloadMedia(item) {
    const url = await mediaUrl(item);
    const link = document.createElement("a");
    link.href = url;
    link.download = item.fileName || "arquivo";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function openMediaExternally(item) {
    const url = await mediaUrl(item);
    window.open(url, "_blank", "noopener");
  }

  function renderViewer() {
    if (!viewer.open) return;
    const renderId = ++viewerRenderId;
    let overlay = document.querySelector("[data-viewer-overlay]");
    if (overlay) overlay.remove();

    const group = currentViewerGroup();
    const media = currentViewerMedia();
    clampViewerIndex();
    const item = media[viewer.index];
    if (!group || !item) {
      closeViewer();
      return;
    }

    overlay = document.createElement("section");
    overlay.className = "viewer-overlay";
    overlay.dataset.viewerOverlay = "true";
    overlay.tabIndex = -1;

    const title = text(item.title || item.fileName || group.groupTitle);
    const groupLabel = text(group.groupTitle || moduleTitle());
    overlay.innerHTML = `
      <div class="viewer-topbar">
        <div class="viewer-title">
          <strong>${html(title)}</strong>
          <span>${html(groupLabel)}</span>
        </div>
        <div class="viewer-actions">
          <button type="button" class="viewer-button" data-viewer-download>Baixar</button>
          <button type="button" class="viewer-button" data-viewer-close>Voltar</button>
        </div>
      </div>
      <div class="viewer-stage" data-viewer-stage>
        <button type="button" class="viewer-nav viewer-nav-prev" data-viewer-prev aria-label="Item anterior">&lt;</button>
        <div class="viewer-loading">Carregando...</div>
        <button type="button" class="viewer-nav viewer-nav-next" data-viewer-next aria-label="Próximo item">&gt;</button>
      </div>
      <div class="viewer-footer">
        <span>${html(`${viewer.index + 1} / ${media.length}`)}</span>
      </div>
    `;

    overlay.querySelector("[data-viewer-close]").addEventListener("click", returnToPreviousPageFromViewer);
    overlay.querySelector("[data-viewer-download]").addEventListener("click", () => downloadMedia(item).catch(() => {}));
    overlay.querySelector("[data-viewer-prev]").addEventListener("click", () => moveViewerImage(-1));
    overlay.querySelector("[data-viewer-next]").addEventListener("click", () => moveViewerImage(1));
    overlay.querySelector(".viewer-footer").appendChild(renderViewerDots(media));

    const stage = overlay.querySelector("[data-viewer-stage]");
    let zoomState = null;
    const mountVisual = (node) => {
      const viewport = document.createElement("div");
      viewport.className = "viewer-viewport";
      const content = document.createElement("div");
      content.className = "viewer-zoom-content";
      content.appendChild(node);
      viewport.appendChild(content);
      const loading = stage.querySelector(".viewer-loading");
      if (loading) loading.replaceWith(viewport);
      if (isZoomableItem(item)) {
        zoomState = createViewerZoom(stage, content);
      }
    };
    if (isImageItem(item)) {
      mediaUrl(item).then((url) => {
        if (renderId !== viewerRenderId || !viewer.open) return;
        const image = document.createElement("img");
        image.className = "viewer-image";
        image.src = url;
        image.alt = title;
        mountVisual(image);
      }).catch(() => {
        const loading = stage.querySelector(".viewer-loading");
        if (loading) loading.textContent = "Não foi possível abrir a imagem.";
      });
    } else {
      const panel = document.createElement("div");
      panel.className = "viewer-document";
      panel.innerHTML = `<strong>${html(item.fileName || "Arquivo")}</strong><span>${html(item.mime || "Arquivo")}</span>`;
      panel.appendChild(button("viewer-button", "Abrir arquivo", () => openMediaExternally(item).catch(() => {})));
      const loading = stage.querySelector(".viewer-loading");
      if (loading) loading.replaceWith(panel);
    }

    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let pointerId = null;
    const activePointers = new Map();
    let pinchStartDistance = 0;
    let pinchStartScale = VIEWER_MIN_ZOOM;
    let didPinch = false;
    const pointerDistance = () => {
      const points = Array.from(activePointers.values());
      if (points.length < 2) return 0;
      return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    };
    const resetSinglePointerFromRemaining = () => {
      const first = activePointers.entries().next();
      if (first.done) {
        pointerId = null;
        return;
      }
      pointerId = first.value[0];
      startX = first.value[1].x;
      startY = first.value[1].y;
      lastX = first.value[1].x;
      lastY = first.value[1].y;
    };
    stage.addEventListener("pointerdown", (event) => {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      stage.setPointerCapture(event.pointerId);
      if (activePointers.size === 2 && zoomState) {
        didPinch = true;
        pinchStartDistance = pointerDistance();
        pinchStartScale = zoomState.scale;
        return;
      }
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      lastX = event.clientX;
      lastY = event.clientY;
    });
    stage.addEventListener("pointermove", (event) => {
      if (activePointers.has(event.pointerId)) {
        activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (activePointers.size >= 2 && zoomState) {
        didPinch = true;
        const distance = pointerDistance();
        if (pinchStartDistance > 0) {
          zoomState.setScale(pinchStartScale * (distance / pinchStartDistance));
        }
        return;
      }
      if (pointerId !== event.pointerId || !zoomState || !zoomState.isZoomed()) return;
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      zoomState.panBy(deltaX, deltaY);
    });
    stage.addEventListener("pointerup", (event) => {
      activePointers.delete(event.pointerId);
      if (didPinch) {
        if (activePointers.size < 2) {
          didPinch = false;
          pinchStartDistance = 0;
          resetSinglePointerFromRemaining();
        }
        return;
      }
      if (pointerId !== event.pointerId) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      pointerId = null;
      if (zoomState && zoomState.isZoomed()) return;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 42) return;
      if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        moveViewerImage(deltaX < 0 ? 1 : -1);
      } else if (isPdfItem(item)) {
        return;
      } else {
        moveViewerGroup(deltaY < 0 ? 1 : -1);
      }
    });
    stage.addEventListener("pointercancel", (event) => {
      activePointers.delete(event.pointerId);
      pointerId = null;
      didPinch = false;
      pinchStartDistance = 0;
    });

    document.body.appendChild(overlay);
    overlay.focus();
    preloadViewerNeighbors();
  }

  function renderGroup() {
    const group = selectedGroup();
    const entry = moduleEntry(view.module);
    clear();
    root.appendChild(renderTopbar());

    const title = group && (group.groupTitle || group.name || group.label);
    const subtitle = entry.directMedia ? entry.description : moduleTitle();
    const head = document.createElement("section");
    head.className = "section-head";
    head.innerHTML = `<div><h1>${html(title || moduleTitle())}</h1><p>${html(subtitle)}</p></div>`;
    head.appendChild(button("back-button", "Voltar", () => {
      if (entry.directMedia) {
        view = { screen: "home", module: "", groupId: "" };
        renderHome();
        return;
      }
      view = { screen: "module", module: view.module, groupId: "" };
      renderModule();
    }));
    root.appendChild(head);

    const media = mediaForGroup(group);
    if (!media.length) {
      renderEmpty("Nenhum arquivo disponivel.");
      return;
    }

    const grid = document.createElement("section");
    grid.className = "media-grid";
    media.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "media-card";

      if (isImageItem(item)) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.alt = text(item.title || item.fileName || title || "Imagem");
        if (cryptoState.encrypted) {
          img.className = "is-loading";
          mediaUrl(item).then((url) => {
            img.src = url;
            img.classList.remove("is-loading");
          }).catch(() => {
            img.classList.remove("is-loading");
          });
        } else {
          img.src = item.mediaPath;
        }
        img.addEventListener("click", () => openViewer(index));
        card.appendChild(img);
      } else {
        const placeholder = document.createElement("button");
        placeholder.type = "button";
        placeholder.className = "media-placeholder";
        placeholder.innerHTML = `<strong>${isPdfItem(item) ? "PDF" : "Arquivo"}</strong><span>${html(item.ext || item.mime || "")}</span>`;
        placeholder.addEventListener("click", () => openViewer(index));
        card.appendChild(placeholder);
      }

      const meta = document.createElement("div");
      meta.className = "media-meta";
      meta.innerHTML = `
        <strong>${html(item.title || item.fileName)}</strong>
        <span>${html([item.date, item.environmentName].filter(Boolean).map(text).join(" - "))}</span>
        <div class="media-actions">
          <button type="button" data-media-open>Abrir</button>
          <button type="button" data-media-download>Baixar</button>
        </div>
      `;
      meta.querySelector("[data-media-open]").addEventListener("click", () => openViewer(index));
      meta.querySelector("[data-media-download]").addEventListener("click", () => downloadMedia(item).catch(() => {}));
      card.appendChild(meta);
      grid.appendChild(card);
    });
    root.appendChild(grid);
  }

  function renderEmpty(message) {
    const empty = document.createElement("section");
    empty.className = "empty-state";
    empty.innerHTML = `<p>${html(message)}</p>`;
    root.appendChild(empty);
  }

  function renderPasswordGate(message) {
    clear();
    const panel = document.createElement("section");
    panel.className = "password-panel";
    panel.innerHTML = `
      <div class="brand-mark">AE</div>
      <h1>Área técnica</h1>
      <p>${html(message || "Digite a senha local para abrir esta página.")}</p>
      <form data-password-form>
        <input type="password" autocomplete="current-password" placeholder="Senha" required>
        <button type="submit">Entrar</button>
      </form>
      <span data-password-error></span>
    `;
    const form = panel.querySelector("[data-password-form]");
    const input = form.querySelector("input");
    const error = panel.querySelector("[data-password-error]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "Abrindo...";
      try {
        const salt = base64UrlToBytes(publicManifest.salt || "");
        const key = await derivePasswordKey(input.value, salt, Number(publicManifest.iterations) || 210000);
        manifest = await decryptJson(publicManifest, key);
        cryptoState.encrypted = true;
        cryptoState.key = key;
        renderHome();
      } catch (failure) {
        error.textContent = "Senha inválida ou página corrompida.";
      }
    });
    root.appendChild(panel);
    input.focus();
  }

  async function loadManifest() {
    const response = await fetch("manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    publicManifest = await response.json();

    if (!publicManifest.encryption || publicManifest.encryption === "none") {
      manifest = publicManifest;
      cryptoState.encrypted = false;
      return true;
    }

    if (!crypto.subtle) {
      throw new Error("Web Crypto indisponivel neste navegador.");
    }

    if (publicManifest.encryption === "aes-gcm") {
      const rawKey = base64UrlToBytes(hashParam("k"));
      if (rawKey.length !== 32) throw new Error("Chave ausente no link.");
      const key = await importAesKey(rawKey);
      manifest = await decryptJson(publicManifest, key);
      cryptoState.encrypted = true;
      cryptoState.key = key;
      return true;
    }

    if (publicManifest.encryption === "pbkdf2-aes-gcm") {
      renderPasswordGate();
      return false;
    }

    throw new Error(`Criptografia não suportada: ${publicManifest.encryption}`);
  }

  async function boot() {
    try {
      const ready = await loadManifest();
      if (ready) {
        if (manifest && manifest.kind === "engineer-index") renderEngineerIndex();
        else renderHome();
      }
    } catch (error) {
      clear();
      const empty = document.createElement("section");
      empty.className = "empty-state";
      empty.innerHTML = `<div class="brand-mark">AE</div><h1>Erro ao abrir</h1><p>Manifest não encontrado, link incompleto ou senha inválida.</p>`;
      root.appendChild(empty);
    }
  }

  document.addEventListener("keydown", (event) => {
    if (!viewer.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      returnToPreviousPageFromViewer();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveViewerImage(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveViewerImage(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveViewerGroup(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveViewerGroup(1);
    }
  });

  await boot();
}());
