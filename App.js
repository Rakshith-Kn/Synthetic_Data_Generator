import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Login from "./Login";
import Dashboard from "./Dashboard";
import Results from "./Results";
import "./App.css";

function App() {
  const [username, setUsername] = useState("");
  const [originalData, setOriginalData] = useState([]);
  const [syntheticData, setSyntheticData] = useState([]);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login setUsername={setUsername} />} />

        <Route
          path="/dashboard"
          element={
            <Dashboard
              username={username}
              originalData={originalData}
              setOriginalData={setOriginalData}
              syntheticData={syntheticData}
              setSyntheticData={setSyntheticData}
            />
          }
        />

        <Route
          path="/results"
          element={
            <Results
              username={username}
              originalData={originalData}
              syntheticData={syntheticData}
              setSyntheticData={setSyntheticData}
            />
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
