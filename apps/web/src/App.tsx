import { Navigate, Route, Routes } from "react-router-dom";
import { token } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { RoomPage } from "./pages/RoomPage";
function Guard({ children }: { children: React.ReactNode }) { return token.get() ? children : <Navigate to="/login" replace />; }
export function App() { return <Routes><Route path="/login" element={<AuthPage/>}/><Route path="/" element={<Guard><DashboardPage/></Guard>}/><Route path="/room/:code" element={<Guard><RoomPage/></Guard>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>; }
