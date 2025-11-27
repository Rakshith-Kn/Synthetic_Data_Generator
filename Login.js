import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Login({ setUsername }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleLogin = (e) => {
    e.preventDefault();
    if (!user.trim() || !password.trim()) {
      alert("Please enter username and password");
      return;
    }
    setUsername(user.trim());
    navigate("/dashboard");
  };

  return (
    <div className="login-page">
      <div className="login-card glass">
        <h1 className="brand">🧬 SynDataGen</h1>
        <p className="muted">Privacy-Preserving Synthetic Data Generator</p>
        <form onSubmit={handleLogin} className="login-form">
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Username"
            className="input"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="input"
          />
          <button className="primary-btn" type="submit">Login</button>
        </form>
      </div>
    </div>
  );
}
