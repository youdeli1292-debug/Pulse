/* =========================================================================
   Pulse — Electron shell for the Xeno C++ core (renderer)

   • Monaco is locked to Lua, the built-in fallback editor is Lua-only too
   • left column:  Execute / Clear / Attach / Open File / Script Hub
   • right column: Script Hub — click a script to load it into the editor
   • bottom:      slim status bar with Status: Not Attached / Status: Attached

   All privileged work happens in main.js:
     Attach  -> pulse:attach    (native FFI into Xeno.dll, or the compiled
                                 core module spawned with child_process)
     Execute -> pulse:execute   (core when attached, local Lua otherwise)
   ========================================================================= */

'use strict';

const LANGUAGE = 'lua';

const state = {
  tabs: [],
  activeTabId: null,
  busy: false,
  attached: false,
  core: { available: false, mode: 'none', dllPath: null, exePath: null, addonPath: null, port: 19283 },
  clients: [],
  hubOpen: true,
  filter: '',
  luaAvailable: false,
  appInfo: null,
  engine: 'pulse-core',
  output: [],
  toastTimer: null,
};

const $ = (id) => document.getElementById(id);

const dom = {
  tabs: $('tabs'),
  host: $('editor-host'),
  boot: $('editor-boot'),
  fallback: $('pulse-editor'),
  gutter: $('gutter'),
  highlight: $('highlight').querySelector('code'),
  input: $('code'),

  hub: $('hub'),
  hubList: $('hub-list'),
  hubSearch: $('hub-search'),
  hubCount: $('hub-count'),

  toast: $('toast'),
  toastTitle: $('toast-title'),
  toastBody: $('toast-body'),

  statusFile: $('status-file'),
  appVersion: $('app-version'),
  sideCore: $('side-core'),
  sideMode: $('side-mode'),
  sideClients: $('side-clients'),
  sideEngine: $('side-engine'),

  stStatus: $('st-status'),
  stClients: $('st-clients'),
  stMessage: $('st-message'),
  stPos: $('st-pos'),
  stEngine: $('st-engine'),

  btnAttach: $('btn-attach'),
};

/* =========================================================================
   Script Hub catalogue — Lua templates built on the documented Roblox API.
   Self-contained demos for your own places / private servers: no network
   calls, no data collection, every effect is reversible.
   ========================================================================= */

const SCRIPTS = [
  {
    id: 'fly',
    name: 'Fly Script',
    tag: 'movement',
    code:
`--[[
    Pulse - Fly Script
    F       toggle flight
    WASD    move      Space / LShift    up / down
]]
local Players           = game:GetService("Players")
local RunService        = game:GetService("RunService")
local UserInputService  = game:GetService("UserInputService")

local player = Players.LocalPlayer
local SPEED  = 60
local flying = false

local bodyVelocity, bodyGyro
local connections = {}

local function getRoot()
    local character = player.Character or player.CharacterAdded:Wait()
    return character:WaitForChild("HumanoidRootPart")
end

local function stop()
    flying = false
    for _, connection in ipairs(connections) do
        connection:Disconnect()
    end
    connections = {}
    if bodyVelocity then bodyVelocity:Destroy() bodyVelocity = nil end
    if bodyGyro     then bodyGyro:Destroy()     bodyGyro     = nil end
end

local function start()
    if flying then return end
    local root = getRoot()

    bodyVelocity = Instance.new("BodyVelocity")
    bodyVelocity.MaxForce = Vector3.new(1, 1, 1) * 100000
    bodyVelocity.Velocity = Vector3.new(0, 0, 0)
    bodyVelocity.Parent   = root

    bodyGyro = Instance.new("BodyGyro")
    bodyGyro.MaxTorque = Vector3.new(1, 1, 1) * 100000
    bodyGyro.P         = 90000
    bodyGyro.CFrame    = root.CFrame
    bodyGyro.Parent    = root

    flying = true

    connections[#connections + 1] = RunService.RenderStepped:Connect(function()
        if not flying or not bodyVelocity or not bodyGyro then return end
        local camera    = workspace.CurrentCamera
        local direction = Vector3.new(0, 0, 0)

        if UserInputService:IsKeyDown(Enum.KeyCode.W) then
            direction = direction + camera.CFrame.LookVector
        end
        if UserInputService:IsKeyDown(Enum.KeyCode.S) then
            direction = direction - camera.CFrame.LookVector
        end
        if UserInputService:IsKeyDown(Enum.KeyCode.A) then
            direction = direction - camera.CFrame.RightVector
        end
        if UserInputService:IsKeyDown(Enum.KeyCode.D) then
            direction = direction + camera.CFrame.RightVector
        end
        if UserInputService:IsKeyDown(Enum.KeyCode.Space) then
            direction = direction + Vector3.new(0, 1, 0)
        end
        if UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) then
            direction = direction - Vector3.new(0, 1, 0)
        end

        if direction.Magnitude > 0 then
            direction = direction.Unit
        end

        bodyVelocity.Velocity = direction * SPEED
        bodyGyro.CFrame       = camera.CFrame
    end)
end

UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if gameProcessed then return end
    if input.KeyCode == Enum.KeyCode.F then
        if flying then stop() else start() end
    end
end)

player.CharacterRemoving:Connect(stop)

print("[Pulse] Fly Script loaded - press F to fly")
`,
  },
  {
    id: 'esp',
    name: 'ESP',
    tag: 'visual',
    code:
`--[[
    Pulse - ESP
    Draws a highlight box + name/distance label above every player.
]]
local Players    = game:GetService("Players")
local RunService = game:GetService("RunService")

local CONFIG = {
    Enabled           = true,
    ShowDistance      = true,
    MaxDistance       = 800,
    FillTransparency  = 0.65,
    FriendColor       = Color3.fromRGB(80, 255, 170),
    EnemyColor        = Color3.fromRGB(255, 90, 160),
    TextColor         = Color3.fromRGB(235, 225, 255),
}

local localPlayer = Players.LocalPlayer
local camera      = workspace.CurrentCamera
local tracked     = {}

local function makeLabel(name)
    local gui = Instance.new("BillboardGui")
    gui.Name        = "PulseTag"
    gui.Size        = UDim2.new(0, 160, 0, 34)
    gui.StudsOffset = Vector3.new(0, 2.6, 0)
    gui.AlwaysOnTop = true
    gui.MaxDistance = CONFIG.MaxDistance

    local text = Instance.new("TextLabel")
    text.Name                   = "Label"
    text.Size                   = UDim2.new(1, 0, 1, 0)
    text.BackgroundTransparency = 1
    text.Text                   = name
    text.TextColor3             = CONFIG.TextColor
    text.TextStrokeTransparency = 0.4
    text.TextSize               = 14
    text.Font                   = Enum.Font.GothamBold
    text.Parent                 = gui

    return gui, text
end

local function attach(character, player)
    if character:GetAttribute("PulseEsp") then return end
    character:SetAttribute("PulseEsp", true)

    local highlight = Instance.new("Highlight")
    highlight.Name                = "PulseHighlight"
    highlight.FillTransparency    = CONFIG.FillTransparency
    highlight.OutlineColor        = Color3.fromRGB(255, 255, 255)
    highlight.OutlineTransparency = 0.2
    highlight.Adornee             = character
    highlight.Parent              = character

    local gui, label = makeLabel(player.DisplayName)
    gui.Adornee = character:WaitForChild("Head", 5)
    gui.Parent  = character

    tracked[player] = { highlight = highlight, gui = gui, label = label }
end

local function detach(player)
    local entry = tracked[player]
    if not entry then return end
    if entry.highlight then entry.highlight:Destroy() end
    if entry.gui       then entry.gui:Destroy()       end
    tracked[player] = nil
end

local function watch(player)
    player.CharacterAdded:Connect(function(character)
        task.wait(0.35)
        if CONFIG.Enabled then attach(character, player) end
    end)
    player.CharacterRemoving:Connect(function()
        detach(player)
    end)
    if player.Character then attach(player.Character, player) end
end

Players.PlayerAdded:Connect(watch)
Players.PlayerRemoving:Connect(detach)
for _, player in ipairs(Players:GetPlayers()) do
    if player ~= localPlayer then watch(player) end
end

RunService.RenderStepped:Connect(function()
    if not CONFIG.Enabled then return end
    for player, entry in pairs(tracked) do
        local character = player.Character
        local root      = character and character:FindFirstChild("HumanoidRootPart")
        if root then
            local distance = (root.Position - camera.CFrame.Position).Magnitude
            entry.highlight.FillColor = (player.Team and player.Team == localPlayer.Team)
                and CONFIG.FriendColor or CONFIG.EnemyColor
            entry.gui.Enabled = distance <= CONFIG.MaxDistance
            if CONFIG.ShowDistance then
                entry.label.Text = string.format("%s\\n%d m", player.DisplayName, math.floor(distance))
            end
        end
    end
end)

print("[Pulse] ESP loaded - " .. tostring(#Players:GetPlayers()) .. " player(s) tracked")
`,
  },
  {
    id: 'infinite-yield',
    name: 'Infinite Yield',
    tag: 'admin',
    code:
`--[[
    Pulse - Infinite Yield (mini)
    Compact admin command bar. Press ; (or click the box) to type.

    Commands:  fly  noclip  esp  speed <n>  jump <n>  heal  reset  cmds
]]
local Players          = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local RunService       = game:GetService("RunService")

local player    = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local screen = Instance.new("ScreenGui")
screen.Name           = "PulseAdmin"
screen.ResetOnSpawn   = false
screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
screen.Parent         = playerGui

local frame = Instance.new("Frame")
frame.Size                   = UDim2.new(0, 300, 0, 32)
frame.Position               = UDim2.new(0.5, -150, 0, 12)
frame.BackgroundColor3       = Color3.fromRGB(16, 10, 28)
frame.BackgroundTransparency = 0.15
frame.BorderSizePixel        = 0
frame.Parent                 = screen

local stroke = Instance.new("UIStroke")
stroke.Color     = Color3.fromRGB(168, 85, 247)
stroke.Thickness = 1
stroke.Parent    = frame

local box = Instance.new("TextBox")
box.Size                   = UDim2.new(1, -16, 1, 0)
box.Position               = UDim2.new(0, 8, 0, 0)
box.BackgroundTransparency = 1
box.TextColor3             = Color3.fromRGB(233, 224, 247)
box.PlaceholderText        = "type a command (cmds)"
box.PlaceholderColor3      = Color3.fromRGB(120, 105, 150)
box.TextXAlignment         = Enum.TextXAlignment.Left
box.Font                   = Enum.Font.Gotham
box.TextSize               = 14
box.ClearTextOnFocus       = false
box.Parent                 = frame

local flying, noclip = false, false
local bodyVelocity, noclipConnection

local function getCharacter()
    return player.Character or player.CharacterAdded:Wait()
end

local function toggleFly()
    flying = not flying
    local root = getCharacter():WaitForChild("HumanoidRootPart")
    if flying then
        bodyVelocity = Instance.new("BodyVelocity")
        bodyVelocity.MaxForce = Vector3.new(1, 1, 1) * 100000
        bodyVelocity.Parent   = root
        while flying do
            local camera = workspace.CurrentCamera
            local move   = Vector3.new(0, 0, 0)
            if UserInputService:IsKeyDown(Enum.KeyCode.W) then move = move + camera.CFrame.LookVector end
            if UserInputService:IsKeyDown(Enum.KeyCode.S) then move = move - camera.CFrame.LookVector end
            if UserInputService:IsKeyDown(Enum.KeyCode.A) then move = move - camera.CFrame.RightVector end
            if UserInputService:IsKeyDown(Enum.KeyCode.D) then move = move + camera.CFrame.RightVector end
            if bodyVelocity and bodyVelocity.Parent then
                bodyVelocity.Velocity = (move.Magnitude > 0 and move.Unit * 55 or Vector3.new(0, 0, 0))
            end
            RunService.RenderStepped:Wait()
        end
        if bodyVelocity then bodyVelocity:Destroy() bodyVelocity = nil end
    end
    return "fly " .. (flying and "on" or "off")
end

local function toggleNoclip()
    noclip = not noclip
    if noclip then
        noclipConnection = RunService.Stepped:Connect(function()
            local character = player.Character
            if not character then return end
            for _, part in ipairs(character:GetDescendants()) do
                if part:IsA("BasePart") then part.CanCollide = false end
            end
        end)
    elseif noclipConnection then
        noclipConnection:Disconnect()
        noclipConnection = nil
    end
    return "noclip " .. (noclip and "on" or "off")
end

local COMMANDS = {
    fly    = toggleFly,
    noclip = toggleNoclip,
    speed  = function(value)
        local human = getCharacter():FindFirstChildOfClass("Humanoid")
        if human then human.WalkSpeed = tonumber(value) or 16 end
        return "walkspeed = " .. tostring(human and human.WalkSpeed)
    end,
    jump = function(value)
        local human = getCharacter():FindFirstChildOfClass("Humanoid")
        if human then human.JumpPower = tonumber(value) or 50 end
        return "jumppower = " .. tostring(human and human.JumpPower)
    end,
    heal = function()
        local human = getCharacter():FindFirstChildOfClass("Humanoid")
        if human then human.Health = human.MaxHealth end
        return "healed"
    end,
    reset = function()
        local human = getCharacter():FindFirstChildOfClass("Humanoid")
        if human then human.Health = 0 end
        return "respawning"
    end,
    esp = function()
        return "open the ESP entry in the Script Hub"
    end,
    cmds = function()
        return "fly | noclip | speed <n> | jump <n> | heal | reset | cmds"
    end,
}

local function run(raw)
    local parts = {}
    for word in string.gmatch(raw, "%S+") do
        table.insert(parts, word)
    end
    local name = parts[1]
    if not name then return end
    local handler = COMMANDS[string.lower(name)]
    if not handler then
        warn("[Pulse] unknown command: " .. name)
        return
    end
    local ok, result = pcall(handler, parts[2])
    print("[Pulse] " .. (ok and tostring(result) or "error: " .. tostring(result)))
end

box.FocusLost:Connect(function(enterPressed)
    if not enterPressed then return end
    local text = box.Text
    box.Text = ""
    if text ~= "" then task.spawn(run, text) end
end)

UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if gameProcessed then return end
    if input.KeyCode == Enum.KeyCode.Semicolon then
        box:CaptureFocus()
    end
end)

print("[Pulse] Infinite Yield (mini) loaded - press ; to open the command bar")
`,
  },
  {
    id: 'aimbot',
    name: 'AimBot',
    tag: 'combat',
    code:
`--[[
    Pulse - AimBot (aim assist template)
    Hold right mouse button to lock onto the closest visible target.
    Needs an environment that exposes mousemoverel().
]]
local Players          = game:GetService("Players")
local RunService       = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local camera = workspace.CurrentCamera

local CONFIG = {
    Enabled     = true,
    AimPart     = "Head",
    FOV         = 150,   -- radius in pixels
    MaxDistance = 300,
    TeamCheck   = true,
    Smoothness  = 0.35,  -- 0..1, 1 = instant
    WallCheck   = true,
}

if type(mousemoverel) ~= "function" then
    warn("[Pulse] mousemoverel() is unavailable in this environment")
    return
end

local localPlayer = Players.LocalPlayer

local function sameTeam(other)
    return CONFIG.TeamCheck and other.Team == localPlayer.Team
end

local function visible(part)
    if not CONFIG.WallCheck then return true end
    local origin = camera.CFrame.Position
    local params = RaycastParams.new()
    params.FilterType                 = Enum.RaycastFilterType.Blacklist
    params.FilterDescendantsInstances = { localPlayer.Character }
    local hit = workspace:Raycast(origin, part.Position - origin, params)
    return (not hit) or hit.Instance:IsDescendantOf(part.Parent)
end

local function closestTarget()
    local best, bestDistance = nil, math.huge
    local centre = camera.ViewportSize / 2

    for _, other in ipairs(Players:GetPlayers()) do
        if other ~= localPlayer and other.Character and not sameTeam(other) then
            local part  = other.Character:FindFirstChild(CONFIG.AimPart)
            local human = other.Character:FindFirstChildOfClass("Humanoid")
            if part and human and human.Health > 0 then
                local screen, onScreen = camera:WorldToViewportPoint(part.Position)
                local distance3d = (part.Position - camera.CFrame.Position).Magnitude
                if onScreen and distance3d <= CONFIG.MaxDistance then
                    local offset = (Vector2.new(screen.X, screen.Y) - centre).Magnitude
                    if offset <= CONFIG.FOV and offset < bestDistance and visible(part) then
                        best, bestDistance = part, offset
                    end
                end
            end
        end
    end

    return best
end

RunService.RenderStepped:Connect(function()
    if not CONFIG.Enabled then return end
    if not UserInputService:IsMouseButtonPressed(Enum.UserInputType.MouseButton2) then return end

    local target = closestTarget()
    if not target then return end

    local screen = camera:WorldToViewportPoint(target.Position)
    local centre = camera.ViewportSize / 2
    mousemoverel((screen.X - centre.X) * CONFIG.Smoothness, (screen.Y - centre.Y) * CONFIG.Smoothness)
end)

print("[Pulse] AimBot loaded - hold RMB to assist")
`,
  },
  {
    id: 'speedhack',
    name: 'SpeedHack',
    tag: 'movement',
    code:
`--[[
    Pulse - SpeedHack
    Numpad + / -   change speed by 5
    Numpad *       reset to the default speed
]]
local Players          = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer

local CONFIG = { Speed = 32, Default = 16, Step = 5, Min = 8, Max = 200 }

local function apply()
    local character = player.Character
    local human     = character and character:FindFirstChildOfClass("Humanoid")
    if human then human.WalkSpeed = CONFIG.Speed end
end

local function set(value)
    CONFIG.Speed = math.clamp(value, CONFIG.Min, CONFIG.Max)
    apply()
    print(string.format("[Pulse] WalkSpeed = %d", CONFIG.Speed))
end

player.CharacterAdded:Connect(function()
    task.wait(0.5)
    apply()
end)

UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if gameProcessed then return end
    if input.KeyCode == Enum.KeyCode.KeypadPlus then
        set(CONFIG.Speed + CONFIG.Step)
    elseif input.KeyCode == Enum.KeyCode.KeypadMinus then
        set(CONFIG.Speed - CONFIG.Step)
    elseif input.KeyCode == Enum.KeyCode.KeypadMultiply then
        set(CONFIG.Default)
    end
end)

apply()
print("[Pulse] SpeedHack loaded - use Numpad +/- to adjust")
`,
  },
  {
    id: 'noclip',
    name: 'Noclip',
    tag: 'movement',
    code:
`--[[
    Pulse - Noclip
    Walk through walls. Press N to toggle.
]]
local Players          = game:GetService("Players")
local RunService       = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local player  = Players.LocalPlayer
local enabled = false
local connection

local function characterParts()
    local character = player.Character
    if not character then return {} end
    return character:GetDescendants()
end

local function enable()
    enabled    = true
    connection = RunService.Stepped:Connect(function()
        for _, part in ipairs(characterParts()) do
            if part:IsA("BasePart") and part.CanCollide then
                part.CanCollide = false
            end
        end
    end)
end

local function disable()
    enabled = false
    if connection then
        connection:Disconnect()
        connection = nil
    end
    for _, part in ipairs(characterParts()) do
        if part:IsA("BasePart") then part.CanCollide = true end
    end
end

UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if gameProcessed then return end
    if input.KeyCode == Enum.KeyCode.N then
        if enabled then disable() else enable() end
        print("[Pulse] noclip " .. (enabled and "on" or "off"))
    end
end)

print("[Pulse] Noclip loaded - press N to toggle")
`,
  },
  {
    id: 'anti-afk',
    name: 'Anti-AFK',
    tag: 'utility',
    code:
`--[[
    Pulse - Anti-AFK
    Keeps the session active so you are not disconnected while idle.
]]
local Players     = game:GetService("Players")
local VirtualUser = game:GetService("VirtualUser")

local player = Players.LocalPlayer

local function hook()
    player.Idled:Connect(function()
        VirtualUser:CaptureController()
        VirtualUser:ClickButton2(Vector2.new())
        print("[Pulse] anti-afk: session kept alive")
    end)
end

if player.Idled then hook() end
player.CharacterAdded:Connect(function()
    task.wait(1)
    if player.Idled then hook() end
end)

print("[Pulse] Anti-AFK loaded")
`,
  },
];

/* =========================================================================
   Lua grammar for the built-in fallback editor
   ========================================================================= */

const RULES = {
  lua: [
    { type: 'comment', re: String.raw`--\[\[[\s\S]*?\]\]|--[^\n]*` },
    { type: 'string', re: String.raw`\[\[[\s\S]*?\]\]|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'` },
    { type: 'number', re: String.raw`0[xX][0-9a-fA-F]+|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b` },
    {
      type: 'keyword',
      re: String.raw`\b(?:and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while)\b`,
    },
    {
      type: 'builtin',
      re: String.raw`\b(?:game|workspace|script|Instance|Vector2|Vector3|CFrame|Color3|UDim2|Enum|RaycastParams|print|warn|error|type|tostring|tonumber|pairs|ipairs|string|table|math|task|select|pcall|setmetatable)\b`,
    },
    { type: 'op', re: String.raw`\.\.\.|\.\.|[=~<>]=|[+\-*/%#^<>=(){}[\];:,.&|]` },
  ],
};

const MASTER_CACHE = {};

function masterRegex(language) {
  if (MASTER_CACHE[language] !== undefined) return MASTER_CACHE[language];
  const rules = RULES[language];
  if (!rules) { MASTER_CACHE[language] = null; return null; }
  let regex;
  try {
    regex = new RegExp(rules.map((r) => `(${r.re})`).join('|'), 'g');
  } catch (error) {
    console.warn('[pulse] invalid grammar', error.message);
    MASTER_CACHE[language] = null;
    return null;
  }
  MASTER_CACHE[language] = { regex, rules };
  return MASTER_CACHE[language];
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightCode(text, language) {
  const entry = masterRegex(language);
  if (!entry) return escapeHtml(text);

  let out = '';
  let last = 0;
  const re = entry.regex;
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) { re.lastIndex += 1; continue; }
    if (match.index > last) out += escapeHtml(text.slice(last, match.index));
    let type = null;
    for (let i = 1; i <= entry.rules.length; i += 1) {
      if (match[i] !== undefined) { type = entry.rules[i - 1].type; break; }
    }
    out += type ? `<span class="tok-${type}">${escapeHtml(match[0])}</span>` : escapeHtml(match[0]);
    last = match.index + match[0].length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

const FallbackEditor = {
  onChange: null,
  onCursor: null,

  init() {
    dom.input.addEventListener('input', () => this.render(true));
    dom.input.addEventListener('scroll', () => {
      dom.highlight.parentElement.scrollTop = dom.input.scrollTop;
      dom.highlight.parentElement.scrollLeft = dom.input.scrollLeft;
      dom.gutter.scrollTop = dom.input.scrollTop;
    });
    dom.input.addEventListener('keyup', () => this.cursor());
    dom.input.addEventListener('click', () => this.cursor());
    dom.input.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        const el = dom.input;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        el.value = `${el.value.slice(0, start)}  ${el.value.slice(end)}`;
        el.selectionStart = el.selectionEnd = start + 2;
        this.render(true);
      }
    });
    this.render();
  },

  getValue() { return dom.input.value; },

  setValue(value) {
    dom.input.value = value == null ? '' : String(value);
    dom.input.scrollTop = 0;
    dom.input.selectionStart = dom.input.selectionEnd = 0;
    this.render();
    this.cursor();
  },

  focus() { dom.input.focus(); },

  layout() { this.render(); },

  render(notify) {
    const value = dom.input.value;
    dom.highlight.innerHTML = `${highlightCode(value, LANGUAGE)}\n`;
    const lines = value.split('\n').length;
    const caretLine = value.slice(0, dom.input.selectionStart).split('\n').length;
    const numbers = [];
    for (let i = 1; i <= Math.max(lines, 1); i += 1) {
      numbers.push(i === caretLine ? `<span class="ln-active">${i}</span>` : String(i));
    }
    dom.gutter.innerHTML = numbers.join('\n');
    if (notify && typeof this.onChange === 'function') this.onChange(value);
  },

  cursor() {
    if (typeof this.onCursor !== 'function') return;
    const lines = dom.input.value.slice(0, dom.input.selectionStart).split('\n');
    this.onCursor({ lineNumber: lines.length, column: lines[lines.length - 1].length + 1 });
  },
};

/* =========================================================================
   Monaco (offline AMD bundle) — always Lua
   ========================================================================= */

let monaco = null;
let monacoEditor = null;

function monacoTheme() {
  return {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5b4b7a', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c084fc' },
      { token: 'string', foreground: '86efac' },
      { token: 'string.escape', foreground: '22d3ee' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'constant', foreground: 'fbbf24' },
      { token: 'identifier', foreground: 'e6dcf5' },
      { token: 'type', foreground: '67e8f9' },
      { token: 'delimiter', foreground: 'd8b4fe' },
      { token: 'operator', foreground: 'd8b4fe' },
      { token: 'function', foreground: 'f472b6' },
    ],
    colors: {
      'editor.background': '#08060f',
      'editor.foreground': '#e6dcf5',
      'editorLineNumber.foreground': '#4b3a68',
      'editorLineNumber.activeForeground': '#c98bff',
      'editorCursor.foreground': '#c98bff',
      'editor.selectionBackground': '#6d28d9aa',
      'editor.lineHighlightBackground': '#160d26',
      'editorLineHighlightBorder': '#2a1a44',
      'editorGutter.background': '#08060f',
      'editorIndentGuide.background1': '#1d1233',
      'editorIndentGuide.activeBackground1': '#6d28d9',
      'editorWidget.background': '#100a1c',
      'editorWidget.border': '#2a1a44',
      'editorSuggestWidget.background': '#100a1c',
      'editorSuggestWidget.selectedBackground': '#2a1a44',
      'scrollbarSlider.background': '#a855f766',
      'scrollbarSlider.hoverBackground': '#a855f7aa',
      'editorBracketMatch.background': '#3b1d6b',
      'editorBracketMatch.border': '#a855f7',
    },
  };
}

function loadMonaco(basePath) {
  return new Promise((resolve, reject) => {
    if (!basePath) { reject(new Error('monaco bundle not found')); return; }

    const timer = setTimeout(() => reject(new Error('monaco loader timed out after 15 s')), 15000);
    const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };
    const done = settle(resolve);
    const fail = settle(reject);

    const baseUrl = basePath.replace(/\\/g, '/').replace(/^\/*/, '/');
    const fileUrl = `file://${baseUrl}`;

    // Web workers cannot be spawned from file:// in Electron; the shim keeps
    // Monaco fully usable (editing + highlighting) without them.
    window.MonacoEnvironment = {
      baseUrl: `${fileUrl}/`,
      getWorkerUrl() {
        const shim = [
          `self.MonacoEnvironment = { baseUrl: "${fileUrl}/" };`,
          `try { importScripts("${fileUrl}/base/worker/workerMain.js"); }`,
          'catch (e) { self.postMessage = self.postMessage || function(){}; }',
        ].join('\n');
        return `data:text/javascript;charset=utf-8,${encodeURIComponent(shim)}`;
      },
    };

    const script = document.createElement('script');
    script.src = `${fileUrl}/loader.js`;
    script.onload = () => {
      if (!window.require || typeof window.require.config !== 'function') {
        fail(new Error('AMD loader unavailable'));
        return;
      }
      window.require.config({ paths: { vs: fileUrl } });
      window.require(['vs/editor/editor.main'], () => done(window.monaco), (error) =>
        fail(error instanceof Error ? error : new Error(String(error && error.message))));
    };
    script.onerror = () => fail(new Error('cannot load monaco loader.js'));
    document.head.appendChild(script);
  });
}

function buildMonacoEditor() {
  const container = document.createElement('div');
  container.id = 'monaco-container';
  dom.host.appendChild(container);

  monaco.editor.defineTheme('pulse-cyber', monacoTheme());

  monacoEditor = monaco.editor.create(container, {
    value: '',
    language: LANGUAGE,               // Lua — permanently
    theme: 'pulse-cyber',
    automaticLayout: true,
    fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace',
    fontSize: 12.5,
    lineHeight: 20,
    fontLigatures: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all',
    cursorBlinking: 'phase',
    cursorSmoothCaretAnimation: 'on',
    smoothScrolling: true,
    padding: { top: 8, bottom: 8 },
    roundedSelection: true,
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: true },
    scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9, useShadows: false },
    wordWrap: 'off',
    tabSize: 2,
    insertSpaces: true,
    contextmenu: true,
  });

  monacoEditor.onDidChangeModelContent(() => {
    markDirty(activeTab());
    updatePositionFromMonaco();
  });
  monacoEditor.onDidChangeCursorPosition(updatePositionFromMonaco);

  if (monaco.languages.lua && monaco.languages.lua.luaDefaults) {
    monaco.languages.lua.luaDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
  }
  if (monaco.languages.typescript) {
    const options = { noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true };
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(options);
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(options);
  }

  dom.fallback.hidden = true;
  state.engine = 'monaco';
  renderStatus();
}

const Editor = {
  getValue() { return monacoEditor ? monacoEditor.getValue() : FallbackEditor.getValue(); },

  setValue(value) {
    if (monacoEditor) {
      monacoEditor.setValue(value == null ? '' : String(value));
      monacoEditor.setPosition({ lineNumber: 1, column: 1 });
      monacoEditor.revealLine(1);
      monacoEditor.focus();
      return;
    }
    FallbackEditor.setValue(value);
    FallbackEditor.focus();
  },

  focus() { if (monacoEditor) monacoEditor.focus(); else FallbackEditor.focus(); },

  layout() { if (monacoEditor) monacoEditor.layout(); else FallbackEditor.layout(); },
};

/* ------------------------------------------------------------------ tabs */

let tabSeq = 0;

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
}

function addTab({ name, path = null, content = '' }) {
  const tab = { id: `tab-${++tabSeq}`, name, path, language: LANGUAGE, dirty: false, model: null, content };
  state.tabs.push(tab);
  setActiveTab(tab.id);
  renderTabs();
  return tab;
}

function closeTab(id) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  const [tab] = state.tabs.splice(index, 1);
  if (tab.model && monaco) tab.model.dispose();
  if (!state.tabs.length) {
    state.activeTabId = null;
    addTab({ name: 'script.lua', content: WELCOME });
  } else if (state.activeTabId === id) {
    setActiveTab(state.tabs[Math.max(0, index - 1)].id);
  }
  renderTabs();
}

function setActiveTab(id) {
  const previous = activeTab();
  if (previous) previous.content = monacoEditor ? monacoEditor.getValue() : FallbackEditor.getValue();

  state.activeTabId = id;
  const tab = activeTab();
  if (!tab) return;

  if (monacoEditor && monaco) {
    if (!tab.model) tab.model = monaco.editor.createModel(tab.content, LANGUAGE);
    monacoEditor.setModel(tab.model);
  } else {
    FallbackEditor.setValue(tab.content);
  }

  dom.statusFile.textContent = tab.name + (tab.dirty ? ' •' : '');
  renderTabs();
  updatePosition();
}

function markDirty(tab) {
  if (!tab || tab.dirty) return;
  tab.dirty = true;
  dom.statusFile.textContent = `${tab.name} •`;
  renderTabs();
}

function renderTabs() {
  dom.tabs.innerHTML = '';
  state.tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = `tab${tab.id === state.activeTabId ? ' is-active' : ''}${tab.dirty ? ' is-dirty' : ''}`;
    el.title = tab.path || tab.name;
    const name = document.createElement('span');
    name.className = 'tab__name';
    name.textContent = tab.name + (tab.dirty ? ' •' : '');
    const close = document.createElement('button');
    close.className = 'tab__close';
    close.textContent = '✕';
    close.title = 'Close tab';
    close.addEventListener('click', (event) => { event.stopPropagation(); closeTab(tab.id); });
    el.append(name, close);
    el.addEventListener('click', () => setActiveTab(tab.id));
    dom.tabs.appendChild(el);
  });
}

function syncActiveContent() {
  const tab = activeTab();
  if (!tab) return;
  tab.content = monacoEditor ? monacoEditor.getValue() : FallbackEditor.getValue();
}

/* --------------------------------------------------------- status / core */

function setAttached(attached, message) {
  state.attached = Boolean(attached);
  dom.stStatus.textContent = state.attached ? 'Status: Attached' : 'Status: Not Attached';
  dom.stStatus.classList.toggle('status-badge--on', state.attached);
  dom.stStatus.classList.toggle('status-badge--off', !state.attached);
  dom.btnAttach.classList.toggle('is-on', state.attached);
  dom.btnAttach.querySelector('.action__text').textContent = state.attached ? 'Detach' : 'Attach';
  if (message) setMessage(message);
}

function setClients(clients) {
  state.clients = Array.isArray(clients) ? clients : [];
  const names = state.clients.map((client) => client.name || `pid ${client.pid}`);
  dom.stClients.textContent = `clients: ${state.clients.length}`;
  dom.stClients.classList.toggle('is-on', state.clients.length > 0);
  dom.stClients.title = names.join(', ');
  dom.sideClients.textContent = String(state.clients.length);
  dom.sideClients.classList.toggle('is-on', state.clients.length > 0);
  dom.sideClients.title = names.join(', ');
}

function setMessage(text) {
  dom.stMessage.textContent = text;
}

function updatePositionFromMonaco() {
  if (!monacoEditor) return;
  const position = monacoEditor.getPosition();
  if (position) dom.stPos.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
}

function updatePosition() {
  if (monacoEditor) updatePositionFromMonaco();
  else FallbackEditor.cursor();
}

function renderStatus() {
  dom.stEngine.textContent = state.engine;
  dom.sideEngine.textContent = state.engine;
  const core = state.core;
  const coreName = core.corePath
    ? core.corePath.split(/[\\/]/).pop()
    : (core.dllPath ? core.dllPath.split(/[\\/]/).pop() : (core.exePath ? core.exePath.split(/[\\/]/).pop() : 'not found'));
  dom.sideCore.textContent = coreName;
  dom.sideCore.classList.toggle('is-on', Boolean(core.ready));
  dom.sideMode.textContent = core.ready ? (core.mode === 'native' ? 'native dll' : `http :${core.port}`) : 'offline';
  dom.sideMode.classList.toggle('is-on', Boolean(core.ready));
  if (state.appInfo) dom.appVersion.textContent = `v${state.appInfo.version}`;
}

function refreshCoreInfo() {
  return window.pulse.xenoInfo()
    .then((info) => { state.core = Object.assign(state.core, info); renderStatus(); return info; })
    .catch(() => state.core);
}

/* ---------------------------------------------------------------- toast */

function showToast(title, text) {
  dom.toastTitle.textContent = title;
  dom.toastBody.textContent = text == null || text === '' ? '(no output)' : text;
  dom.toast.hidden = false;
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 12000);
}

function hideToast() {
  if (state.toastTimer) clearTimeout(state.toastTimer);
  dom.toast.hidden = true;
}

/* ------------------------------------------------------- core: attach --- */

async function attach() {
  if (state.attached) {
    await window.pulse.detach();
    setAttached(false, 'detached');
    setClients([]);
    return;
  }

  setMessage('attaching to the C++ core…');
  const result = await window.pulse.attach();

  if (!result || !result.ok) {
    const reason = (result && result.error) || 'attach failed';
    setAttached(false, `not attached · ${reason}`);
    showToast('attach failed', `${reason}\n\nPut Xeno.dll / Xeno.exe into Xeno\\bin (see Xeno\\README.md).`);
    return;
  }

  setAttached(true, result.mode === 'native'
    ? `core loaded in-process · ${(result.clients || []).length} client(s)`
    : `core ready · ${(result.clients || []).length} client(s)`);
  setClients(result.clients || []);
  await refreshCoreInfo();
}

/* ------------------------------------------------------ core: execute --- */

async function execute() {
  if (state.busy) return;
  const tab = activeTab();
  if (!tab) return;

  syncActiveContent();
  if (!tab.content.trim()) {
    setMessage('nothing to execute — the buffer is empty');
    return;
  }

  state.busy = true;
  state.output = [];
  setBusyUi(true);
  setMessage(state.attached ? 'sending to the core…' : 'running locally…');
  showToast(state.attached ? 'core · execute' : `local lua · ${tab.name}`, '');

  const payload = {
    code: tab.content,
    filePath: tab.path && !tab.dirty ? tab.path : null,
    scriptName: tab.name,
    chunkName: 'Pulse',
  };

  try {
    const result = await window.pulse.execute(payload);

    if (result.engine === 'xeno') {
      if (result.ok) {
        setMessage(`sent to ${result.targets.length} client(s)`);
        showToast('core · sent', `delivered to: ${result.targets.join(', ')}`);
      } else {
        setMessage(result.error || 'execution failed');
        showToast('core · error', result.error || 'unknown error');
      }
    } else if (result.error) {
      setMessage(result.error);
      showToast('error', result.error);
    } else {
      setMessage(`exit ${result.exitCode} · ${result.duration} ms`);
      showToast(`exit ${result.exitCode} · ${result.duration} ms`, state.output.join('') || '(no output)');
    }

    await window.pulse.setProgress(1);
    setTimeout(() => window.pulse.setProgress(-1), 600);
  } catch (error) {
    const text = error && error.message ? error.message : String(error);
    setMessage(`execution failed: ${text}`);
    showToast('error', text);
  } finally {
    state.busy = false;
    setBusyUi(false);
  }
}

function setBusyUi(busy) {
  const button = $('btn-execute');
  button.classList.toggle('is-busy', busy);
  button.querySelector('.action__text').textContent = busy ? 'Running…' : 'Execute';
}

/* ----------------------------------------------------------------- files */

async function openFile() {
  const result = await window.pulse.openFile();
  if (!result || result.canceled) { setMessage('open file cancelled'); return; }
  result.files.forEach((file) => {
    if (file.error) { showToast('open failed', `${file.name}: ${file.error}`); return; }
    addTab({ name: file.name, path: file.path, content: file.content });
    setMessage(`opened ${file.path}`);
  });
}

async function saveFile() {
  const tab = activeTab();
  if (!tab) return;
  syncActiveContent();
  const result = await window.pulse.saveFile({ filePath: tab.path, content: tab.content, suggestedName: tab.name });
  if (!result || result.canceled) { setMessage('save cancelled'); return; }
  if (result.error) { setMessage(`save failed: ${result.error}`); return; }
  tab.path = result.path;
  tab.name = result.name;
  tab.dirty = false;
  dom.statusFile.textContent = tab.name;
  setMessage(`saved ${result.path}`);
  renderTabs();
}

/* ------------------------------------------------------------ script hub */

function renderHub() {
  const query = state.filter.trim().toLowerCase();
  const list = SCRIPTS.filter((script) =>
    !query || script.name.toLowerCase().includes(query) || script.tag.toLowerCase().includes(query));

  dom.hubList.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'hub__empty';
    empty.textContent = 'nothing found';
    dom.hubList.appendChild(empty);
  }

  list.forEach((script) => {
    const item = document.createElement('div');
    item.className = 'script';
    item.title = `Load ${script.name} into the editor`;

    const name = document.createElement('span');
    name.className = 'script__name';
    name.textContent = script.name;

    const tag = document.createElement('span');
    tag.className = 'script__tag';
    tag.textContent = script.tag;

    item.append(name, tag);
    item.addEventListener('click', () => {
      loadScript(script);
      dom.hubList.querySelectorAll('.script').forEach((el) => el.classList.remove('is-active'));
      item.classList.add('is-active');
    });
    dom.hubList.appendChild(item);
  });

  dom.hubCount.textContent = `${list.length} script${list.length === 1 ? '' : 's'}`;
}

function loadScript(script) {
  const tab = activeTab();

  // An untouched buffer is replaced, otherwise the script opens in a new tab
  // so the code you are working on is never lost.
  if (tab && !tab.dirty && !tab.path) {
    tab.name = `${script.id}.lua`;
    tab.content = script.code;
    if (monacoEditor && tab.model) tab.model.setValue(script.code);
    else FallbackEditor.setValue(script.code);
  } else {
    addTab({ name: `${script.id}.lua`, content: script.code });
  }

  if (monacoEditor) monacoEditor.setPosition({ lineNumber: 1, column: 1 });
  dom.statusFile.textContent = `${script.id}.lua`;
  renderTabs();
  Editor.focus();
  updatePosition();
  setMessage(`loaded ${script.name} · ${script.code.split('\n').length} lines`);
}

function toggleHub(force) {
  state.hubOpen = typeof force === 'boolean' ? force : !state.hubOpen;
  document.body.classList.toggle('no-hub', !state.hubOpen);
  $('btn-hub').classList.toggle('is-on', state.hubOpen);
  Editor.layout();
}

/* ------------------------------------------------------------------ init */

const WELCOME =
`--[[
    PULSE  -  Lua executor for the Xeno C++ core
    --------------------------------------------------------------
    Attach    loads Xeno.dll (native) or starts the core module
    Execute   sends the buffer to the core, or runs it with the
              local Lua interpreter when no core is attached
    --------------------------------------------------------------
    Ctrl+Enter  execute     Ctrl+K  clear     Ctrl+B  attach
    Ctrl+O      open file   Ctrl+S  save      Ctrl+H  script hub
    --------------------------------------------------------------
    Pick a script in the Script Hub on the right, or write your own.
]]

local Players = game:GetService("Players")
local player  = Players.LocalPlayer

print("[Pulse] ready - " .. tostring(player and player.Name or "no player"))
`;

async function initLocalLua() {
  const runners = await window.pulse.listRunners().catch(() => []);
  const lua = runners.find((runner) => runner.id === 'lua');
  state.luaAvailable = Boolean(lua && lua.available);
}

function bindUi() {
  $('btn-min').addEventListener('click', () => window.pulse.minimize());
  $('btn-max').addEventListener('click', () => window.pulse.toggleMaximize());
  $('btn-close').addEventListener('click', () => window.pulse.close());

  $('btn-execute').addEventListener('click', execute);
  $('btn-clear').addEventListener('click', () => {
    Editor.setValue('');
    hideToast();
    setMessage('buffer cleared');
    updatePosition();
  });
  $('btn-attach').addEventListener('click', attach);
  $('btn-open').addEventListener('click', openFile);
  $('btn-hub').addEventListener('click', () => toggleHub());

  $('hub-close').addEventListener('click', () => toggleHub(false));
  $('hub-search').addEventListener('input', (event) => {
    state.filter = event.target.value;
    renderHub();
  });
  $('toast-close').addEventListener('click', hideToast);
  dom.stClients.addEventListener('click', () => window.pulse.xenoClients().then((info) => setClients(info.clients || [])));

  window.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();

    if (key === 'enter') { event.preventDefault(); execute(); }
    else if (key === 'k') { event.preventDefault(); Editor.setValue(''); hideToast(); setMessage('buffer cleared'); }
    else if (key === 'b') { event.preventDefault(); attach(); }
    else if (key === 'o') { event.preventDefault(); openFile(); }
    else if (key === 's') { event.preventDefault(); saveFile(); }
    else if (key === 'h') { event.preventDefault(); toggleHub(); }
  });

  window.addEventListener('resize', () => Editor.layout());
}

function bindIpc() {
  window.pulse.on('pulse:run-output', (payload) => {
    if (payload && payload.chunk) state.output.push(String(payload.chunk));
    if (!dom.toast.hidden) {
      dom.toastBody.textContent = state.output.join('').slice(-4000);
      dom.toastBody.scrollTop = dom.toastBody.scrollHeight;
    }
  });

  window.pulse.on('pulse:attach-status', (info) => {
    if (!info) return;
    if (info.connected) {
      setAttached(true, `attached${info.target ? ` · ${info.target}` : ''}`);
      if (Array.isArray(info.clients)) setClients(info.clients);
      refreshCoreInfo();
    } else {
      setAttached(false, `not attached · ${info.reason || 'detached'}`);
      setClients([]);
      refreshCoreInfo();
    }
  });

  window.pulse.on('pulse:clients', (payload) => {
    if (payload) setClients(payload.clients || []);
  });

  window.pulse.on('pulse:window-state', (info) => {
    if (info) $('btn-max').title = info.maximized ? 'Restore' : 'Maximize';
  });
}

async function boot() {
  bindUi();
  bindIpc();
  FallbackEditor.init();
  FallbackEditor.onChange = () => markDirty(activeTab());
  FallbackEditor.onCursor = ({ lineNumber, column }) => {
    dom.stPos.textContent = `Ln ${lineNumber}, Col ${column}`;
  };

  setBusyUi(false);
  setAttached(false);
  setClients([]);
  toggleHub(true);
  addTab({ name: 'script.lua', content: WELCOME });
  renderHub();

  try {
    state.appInfo = await window.pulse.appInfo();
    renderStatus();
  } catch (_) {
    setMessage('cannot read app info');
  }

  await initLocalLua();
  const core = await refreshCoreInfo();
  if (!core.available) {
    setMessage('core not found — put Xeno.dll / Xeno.exe into Xeno\\bin');
  } else if (core.ready) {
    setAttached(true, `core ready · ${core.mode}`);
    setClients(core.clients || []);
  } else {
    setMessage(core.dllPath ? 'core ready — press Attach' : 'core executable ready — press Attach');
  }

  if (state.appInfo && state.appInfo.monacoPath) {
    try {
      monaco = await loadMonaco(state.appInfo.monacoPath);
      buildMonacoEditor();
      const tab = activeTab();
      if (tab) {
        tab.model = monaco.editor.createModel(tab.content, LANGUAGE);
        monacoEditor.setModel(tab.model);
      }
      setMessage(state.attached ? 'monaco ready · core attached' : 'monaco ready');
    } catch (error) {
      if (monacoEditor) {
        try { monacoEditor.dispose(); } catch (_) { /* already gone */ }
        monacoEditor = null;
        monaco = null;
      }
      dom.fallback.hidden = false;
      state.engine = 'pulse-core';
      setMessage(`monaco unavailable — built-in ${state.engine} editor active`);
    }
  }

  dom.boot.hidden = true;
  renderStatus();
  Editor.focus();
  updatePosition();
}

document.addEventListener('DOMContentLoaded', boot);
