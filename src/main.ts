import { createApp } from "vue";
import App from "./App.vue";
import "./index.css";
import { createPinia } from "pinia";
import "vue3-colorpicker/style.css";
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import 'primeicons/primeicons.css'
import { definePreset } from "@primeuix/themes";
import ToastService from 'primevue/toastservice';


const pinia = createPinia();

const Custom = definePreset(Aura, {
    semantic: {
        primary: {
            50: '{orange.50}',
            100: '{orange.100}',
            200: '{orange.200}',
            300: '{orange.300}',
            400: '{orange.400}',
            500: '{orange.500}',
            600: '{orange.600}',
            700: '{orange.700}',
            800: '{orange.800}',
            900: '{orange.900}',
            950: '{orange.950}'
        },
    }
});


createApp(App).use(pinia)
    .use(PrimeVue, {
        theme: {
            preset: Custom,
            options: {
                darkModeSelector: false || 'none',
            }
        }
    })
    .use(ToastService)
    .mount("#app");
