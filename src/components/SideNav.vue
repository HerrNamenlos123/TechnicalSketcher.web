<script setup lang="ts">
import { makeVaultIndexAvailable, useStore, vaultIndex } from "./store";
import { computed, onMounted, ref, watch } from "vue";
import type { FSDirEntry, FSFileEntry } from "@/types";
import { ColorPicker } from "vue3-colorpicker";
import {
  Button,
  InputText,
  PanelMenu,
  Popover,
  useToast,
  type PanelMenuExpandedKeys,
} from "primevue";
import type { MenuItem } from "primevue/menuitem";

const openVault = async () => {
  await store.initVault();
  await store.loadVault();
};

onMounted(async () => {
  await store.loadVault();

  await makeVaultIndexAvailable();
  if (vaultIndex.value?.lastOpened) {
    const file = await store.findFileOptimisticMatch(
      vaultIndex.value.lastOpened,
    );
    if (file) {
      await openFile(file);
    }
  }
});

const store = useStore();

const createFilename = ref("");
const createFilenamePrefix = ref("");

const openFile = async (file: FSFileEntry) => {
  await store.loadAndOpenDocument(file);
};

// const a = () => {
//   // if (store.currentDocument) {
//   //   // console.log("doc", store.currentDocument.pages);
//   //   // for (const page of store.currentDocument.pages) {
//   //   //   console.log(page);
//   //   // }
//   // }
//   setTimeout(a, 1000);
// };
// a();

const toast = useToast();

const exportDoc = async (entry: FSFileEntry) => {
  const doc = store.openDocuments.find(
    (d) => d.fileHandle?.fullPath === entry.fullPath,
  );
  if (doc) {
    await store.exportDocumentAsPdf(doc);
    toast.add({
      severity: "success",
      summary: "Success",
      detail: "Your PDF File was successfully exported",
      life: 3000,
    });
  }
};

const setPageWidth = (x: number) => {
  if (!store.currentlyOpenDocument) return;
  store.currentlyOpenDocument.size_mm.x = x;
  store.triggerRender = true;
};

const setPageHeight = (y: number) => {
  if (!store.currentlyOpenDocument) return;
  store.currentlyOpenDocument.size_mm.y = y;
  store.triggerRender = true;
};

const menuItems = computed<MenuItem[]>(() => {
  if (!store.vault) return [];

  // const sub = [];
  // for (let i = 0; i < 1000; i++) {
  //   sub.push({
  //     label: "test",
  //   });
  // }

  const process = (f: FSFileEntry | FSDirEntry): MenuItem => {
    if (f.type === "file") {
      const isCurrentlyOpen = store.currentlyOpenDocument?.fileHandle?.fullPath === f.fullPath;
      return {
        label: f.filename.replace(/\.tsk$/i, ""),
        key: f.fullPath,
        icon: "pi pi-file",
        class: isCurrentlyOpen ? "tsk-open-file" : undefined,
        command: () => openFile(f),
      };
    } else {
      let children: MenuItem[] = [{}];

      if (expandedFolders.value[f.fullPath]) {
        children = [
          ...f.children.map((f) => process(f)),
          {
            label: "Create new file",
            key: "create-new-file",
            icon: "pi pi-plus",
            command: (event) => {
              create(event.originalEvent, f.fullPath);
            },
          },
        ];
      }

      return {
        label: f.dirname.replace(/\.tsk$/i, ""),
        key: f.fullPath,
        items: children,
        icon: "pi pi-folder",
      };
    }
  };

  const result: MenuItem[] = [
    {
      label: "Files",
      key: "root",
      icon: "pi pi-file",
      items: [
        ...store.vault.filetree.map((f) => process(f)),
        {
          label: "Create new file",
          key: "create-new-file",
          icon: "pi pi-plus",
          command: (event) => {
            create(event.originalEvent, "");
          },
        },
      ],
    },
  ];
  return result;
});

// Persisted into the vault's vault.json (via vaultIndex) instead of localStorage, so which
// folders are expanded syncs across machines along with the rest of the vault. "root" (the
// top-level "Files" group) is always forced open here rather than persisted as collapsible.
const expandedFolders = computed<PanelMenuExpandedKeys>({
  get: () => ({ ...vaultIndex.value?.expandedFolders, root: true }),
  set: (value) => {
    if (!vaultIndex.value) return;
    vaultIndex.value = { ...vaultIndex.value, expandedFolders: value };
  },
});

// Ancestor folder fullPaths of a file's fullPath, e.g. "a/b/file.tsk" -> ["a/", "a/b/"],
// matching how FSDirEntry.fullPath is built (trailing slash, accumulated from the root).
function getAncestorFolderPaths(fullPath: string): string[] {
  const segments = fullPath.split("/").filter(Boolean);
  segments.pop();
  const ancestors: string[] = [];
  let prefix = "";
  for (const segment of segments) {
    prefix += segment + "/";
    ancestors.push(prefix);
  }
  return ancestors;
}

// VSCode-style "reveal active file": whenever the open file changes (including on startup,
// once it's restored from lastOpened), make sure its ancestor folders are expanded so it's
// actually visible in the tree. The file's own highlight already follows reactively via
// `isCurrentlyOpen` in menuItems above.
watch(
  () => store.currentlyOpenDocument?.fileHandle?.fullPath,
  (fullPath) => {
    if (!fullPath || !vaultIndex.value) return;
    const ancestors = getAncestorFolderPaths(fullPath);
    const current = vaultIndex.value.expandedFolders ?? {};
    if (ancestors.every((path) => current[path])) return;
    vaultIndex.value = {
      ...vaultIndex.value,
      expandedFolders: { ...current, ...Object.fromEntries(ancestors.map((path) => [path, true])) },
    };
  },
);

const fileCreateInputRef = ref<InstanceType<typeof InputText>>();

const op = ref();
const create = (event: Event, prefixPath: string) => {
  createFilename.value = "";
  createFilenamePrefix.value = prefixPath;
  op.value.toggle(event);
};

const pdfLoading = ref(false);
</script>

<template>
  <div class="flex flex-col">
    <Popover ref="op">
      <div class="flex flex-col w-[25rem]">
        <span class="font-medium text-lg">Filename</span>
        <InputText
          ref="fileCreateInputRef"
          v-model="createFilename"
          placeholder="Filename"
          type="text"
          autofocus
        />
        <div class="flex w-full justify-start pt-2">
          <Button
            label="Create"
            @click="
              async (e) => {
                await store.createDocument(
                  createFilenamePrefix + createFilename,
                );
                op.toggle(e);
              }
            "
          />
        </div>
      </div>
    </Popover>
    <div class="h-fit">
      <template v-if="store.vault">
        <PanelMenu
          v-model:expanded-keys="expandedFolders"
          style="height: 100%"
          :model="menuItems"
          multiple
        />
      </template>
      <template v-else>
        <Button label="Open Vault" @click="openVault" />
      </template>

      <div
        v-if="store.currentlyOpenDocument?.fileHandle !== undefined"
        class="w-full flex justify-center mt-2"
      >
        <Button
          icon="pi pi-file-pdf"
          label="Export PDF"
          :loading="pdfLoading"
          @click="
            async () => {
              if (store.currentlyOpenDocument?.fileHandle) {
                pdfLoading = true;
                await exportDoc(store.currentlyOpenDocument.fileHandle);
                pdfLoading = false;
              }
            }
          "
        />
      </div>

      <div
        v-if="store.currentlyOpenDocument"
        class="flex items-center gap-2 ml-4 text-xl mt-4"
      >
        <div>{{ "Page Color" }}</div>
        <ColorPicker
          v-model:pure-color="store.currentlyOpenDocument.pageColor"
          @pure-color-change="
            () => {
              store.triggerRender = true;
              store.forceDeepRender = true;
            }
          "
        />
      </div>
      <div
        v-if="store.currentlyOpenDocument"
        class="flex items-center gap-2 ml-4 text-xl mt-4"
      >
        <div>{{ "Grid Color" }}</div>
        <ColorPicker
          v-model:pure-color="store.currentlyOpenDocument.gridColor"
          @pure-color-change="
            () => {
              store.triggerRender = true;
              store.forceDeepRender = true;
            }
          "
        />
      </div>
      <div
        v-if="(store.currentlyOpenDocument?.pages.length || 0) > 0"
        class="flex items-center gap-2 ml-4 text-xl mt-4"
      >
        <div>{{ "Page Width" }}</div>
        <input
          class="w-16 bg-black border"
          type="text"
          :value="store.currentlyOpenDocument?.size_mm.x"
          @input="
            (e) => setPageWidth(Number((e.target as HTMLInputElement).value))
          "
        />
        <div>{{ "mm" }}</div>
      </div>
      <div
        v-if="(store.currentlyOpenDocument?.pages.length || 0) > 0"
        class="flex items-center gap-2 ml-4 text-xl mt-4"
      >
        <div>{{ "Page Height" }}</div>
        <input
          class="w-16 bg-black border"
          type="text"
          :value="store.currentlyOpenDocument?.size_mm.y"
          @input="
            (e) => setPageHeight(Number((e.target as HTMLInputElement).value))
          "
        />
        <div>{{ "mm" }}</div>
      </div>
    </div>
  </div>
</template>

<style>
/* PrimeVue paints the item's background/hover state on the inner content element, not the
   <li> itself, so the highlight has to target that element directly rather than relying on
   item.class on the <li> to show through. !important because PrimeVue's theme CSS is injected
   at runtime (after this component's static styles) and otherwise wins ties at equal/lower
   specificity regardless of source order. */
.tsk-open-file > .p-panelmenu-item-content {
  background-color: rgba(37, 99, 235, 0.15) !important;
  font-weight: 600;
}
</style>
