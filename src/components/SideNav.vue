<script setup lang="ts">
import { useStore } from "./store";
import { computed, onMounted, ref, watch } from "vue";
import type { FSDirEntry, FSFileEntry } from "@/types";
import { ColorPicker } from "vue3-colorpicker";
import {
  Button,
  InputText,
  PanelMenu,
  Popover,
  Tree,
  useToast,
  type PanelMenuExpandedKeys,
} from "primevue";
import type { MenuItem } from "primevue/menuitem";

const openVault = async () => {
  await store.initVault();
  await store.loadVault();
};

onMounted(() => {
  store.loadVault();
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

  const sub = [];
  for (let i = 0; i < 1000; i++) {
    sub.push({
      label: "test",
    });
  }

  const process = (f: FSFileEntry | FSDirEntry): MenuItem => {
    if (f.type === "file") {
      return {
        label: f.filename.replace(/\.tsk$/i, ""),
        key: f.fullPath,
        icon: "pi pi-file",
        command: () => openFile(f),
      };
    } else {
      let children: MenuItem[] = [{}];

      if (expanded.value[f.fullPath]) {
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

const expanded = ref<PanelMenuExpandedKeys>({});

watch(
  expanded,
  () => {
    expanded.value.root = true;
  },
  { deep: true, immediate: true },
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
          v-model:expanded-keys="expanded"
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
