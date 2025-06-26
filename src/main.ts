import { createApp } from "vue";
import App from "./App.vue";
import "./index.css";
import { createPinia } from "pinia";
import "vue3-colorpicker/style.css";

const pinia = createPinia();

createApp(App).use(pinia).mount("#app");
