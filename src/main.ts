import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import { createPinia } from "pinia"; // Import Pinia

const app = createApp(App);
const pinia = createPinia();

app.use(pinia); // Use it
app.mount("#app");
