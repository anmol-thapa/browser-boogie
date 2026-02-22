import { BrowserRouter, Route, Routes } from "react-router-dom";
import BrowsePage from "./pages/BrowsePage";
import EnterCodePage from "./pages/EnterCodePage";
import FriendlyChallengePage from "./pages/FriendlyChallengePage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/friendly-challenge" element={<FriendlyChallengePage />} />
        <Route path="/enter-code" element={<EnterCodePage />} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </BrowserRouter>
  );
}
