/**
 * @fileoverview Implements the PCjs Mouse component.
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a>
 * @version 1.0
 * @suppress {missingProperties}
 * Created 2012-Jul-01
 *
 * Copyright © 2012-2014 Jeff Parsons <Jeff@pcjs.org>
 *
 * This file is part of PCjs, which is part of the JavaScript Machines Project (aka JSMachines)
 * at <http://jsmachines.net/> and <http://pcjs.org/>.
 *
 * PCjs is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * PCjs is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with PCjs.  If not,
 * see <http://www.gnu.org/licenses/gpl.html>.
 *
 * You are required to include the above copyright notice in every source code file of every
 * copy or modified version of this work, and to display that copyright notice on every screen
 * that loads or runs any version of this software (see Computer.sCopyright).
 *
 * Some PCjs files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of the
 * PCjs program for purposes of the GNU General Public License, and the author does not claim
 * any copyright as to their contents.
 */

"use strict";

if (typeof module !== 'undefined') {
    var str = require("../../shared/lib/strlib");
    var web = require("../../shared/lib/weblib");
    var Component = require("../../shared/lib/component");
    var SerialPort = require("./serial");
    var State = require("./state");
}

/**
 * Mouse(parmsMouse)
 *
 * The Mouse component has the following component-specific (parmsMouse) properties:
 *
 *      serial: the ID of the corresponding serial component
 *
 * Since the first version of this component supports ONLY emulation of the original Microsoft
 * serial mouse, a valid serial component ID is required.  It's possible that future versions
 * of this component may support other types of simulated hardware (eg, the Microsoft InPort
 * bus mouse adapter), or a virtual driver interface that would eliminate the need for any
 * intermediate hardware simulation (at the expense of writing an intermediate software layer or
 * virtual driver for each supported operating system).  However, those possibilities are extremely
 * unlikely in the near term.
 *
 * If the 'serial' property is specified, then communication will be established with the
 * SerialPort component, requesting access to the corresponding serial component ID.  If the
 * SerialPort component is not installed and/or the specified serial component ID is not present,
 * a configuration error will be reported.
 *
 * TODO: Just out of curiosity, verify that the Microsoft Bus Mouse used ports 0x23D and 0x23F,
 * because I saw Windows v1.01 probing those ports immediately prior to probing COM2 (and then COM1)
 * for a serial mouse.
 * 
 * @constructor
 * @extends Component
 * @param {Object} parmsMouse
 */
function Mouse(parmsMouse) {

    Component.call(this, "Mouse", parmsMouse, Mouse);

    this.idAdapter = parmsMouse['serial'];
    if (this.idAdapter) {
        this.sAdapterType = "SerialPort";
    }
    this.fActive = false;
    this.setReady();
}

/*
 * From http://paulbourke.net/dataformats/serialmouse:
 * 
 *      The old MicroSoft serial mouse, while no longer in general use, can be employed to provide a low cost input device,
 *      for example, coupling the internal mechanism to other moving objects. The serial protocol for the mouse is:
 *
 *          1200 baud, 7 bit, 1 stop bit, no parity.
 *
 *      The pinout of the connector follows the standard serial interface, as shown below:
 *      
 *          Pin     Abbr    Description
 *          1       DCD     Data Carrier Detect
 *          2       RD      Receive Data            [serial data from mouse to host]
 *          3       TD      Transmit Data
 *          4       DTR     Data Terminal Ready     [used to provide positive voltage to mouse, plus reset/detection]
 *          5       SG      Signal Ground
 *          6       DSR     Data Set Ready
 *          7       RTS     Request To Send         [used to provide positive voltage to mouse]
 *          8       CTS     Clear To Send
 *          9       RI      Ring
 *          
 *      Every time the mouse changes state (moved or button pressed) a three byte "packet" is sent to the serial interface.
 *      For reasons known only to the engineers, the data is arranged as follows, most notably the two high order bits for the
 *      x and y coordinates share the first byte with the button status.
 *
 *                      D6  D5  D4  D3  D2  D1  D0
 *          1st byte    1   LB  RB  Y7  Y6  X7  X6
 *          2nd byte    0   X5  X4  X3  X2  X1  X0
 *          3rd byte    0   Y5  Y4  Y3  Y2  Y1  Y0
 *          
 *      where:
 *      
 *          LB is the state of the left button, 1 = pressed, 0 = released.
 *          RB is the state of the right button, 1 = pressed, 0 = released
 *          X0-7 is movement of the mouse in the X direction since the last packet. Positive movement is toward the right.
 *          Y0-7 is movement of the mouse in the Y direction since the last packet. Positive movement is back, toward the user.
 *          
 * From http://www.kryslix.com/nsfaq/Q.12.html:
 * 
 *      The Microsoft serial mouse is the most popular 2-button mouse. It is supported by all major operating systems.
 *      The maximum tracking rate for a Microsoft mouse is 40 reports/second * 127 counts per report, in other words, 5080 counts
 *      per second. The most common range for mice is is 100 to 400 CPI (counts per inch) but can be up to 1000 CPI. A 100 CPI mouse
 *      can discriminate motion up to 50.8 inches/second while a 400 CPI mouse can only discriminate motion up to 12.7 inches/second.
 *
 *          9-pin  25-pin    Line    Comments
 *          shell  1         GND
 *          3      2         TD      Serial data from host to mouse (only for power)
 *          2      3         RD      Serial data from mouse to host
 *          7      4         RTS     Positive voltage to mouse
 *          8      5         CTS
 *          6      6         DSR
 *          5      7         SGND
 *          4      20        DTR     Positive voltage to mouse and reset/detection
 *
 *      To function correctly, both the RTS and DTR lines must be positive. DTR/DSR and RTS/CTS must NOT be shorted.
 *      RTS may be toggled negative for at least 100ms to reset the mouse. (After a cold boot, the RTS line is usually negative.
 *      This provides an automatic toggle when RTS is brought positive). When DTR is toggled the mouse should send a single byte
 *      (0x4D, ASCII 'M').
 *
 *      Serial data parameters: 1200bps, 7 data bits, 1 stop bit
 *      
 *      Data is sent in 3 byte packets for each event (a button is pressed or released, or the mouse moves):
 *      
 *                  D7  D6  D5  D4  D3  D2  D1  D0
 *          Byte 1  X   1   LB  RB  Y7  Y6  X7  X6
 *          Byte 2  X   0   X5  X4  X3  X2  X1  X0      
 *          Byte 3  X   0   Y5  Y4  Y3  Y2  Y1  Y0
 *
 *      LB is the state of the left button (1 means down).
 *      RB is the state of the right button (1 means down).
 *      X7-X0 movement in X direction since last packet (signed byte).
 *      Y7-Y0 movement in Y direction since last packet (signed byte).
 *      The high order bit of each byte (D7) is ignored. Bit D6 indicates the start of an event, which allows the software to
 *      synchronize with the mouse.
 */

Component.subclass(Component, Mouse);

/**
 * initBus(cmp, bus, cpu, dbg)
 * 
 * @this {Mouse}
 * @param {Computer} cmp
 * @param {Bus} bus
 * @param {X86CPU} cpu
 * @param {Debugger} dbg
 */
Mouse.prototype.initBus = function(cmp, bus, cpu, dbg) {
    this.cmp = cmp;
    this.bus = bus;
    this.cpu = cpu;
    this.dbg = dbg;
    if (DEBUGGER && dbg) {
        dbg.messageInit(Mouse);
    }
};

/**
 * isActive()
 * 
 * @this {Mouse}
 * @return {boolean} true if active, false if not
 */
Mouse.prototype.isActive = function() {
    return this.fActive && (this.cpu ? this.cpu.isRunning() : false);
};

/**
 * powerUp(data, fRepower)
 *
 * @this {Mouse}
 * @param {Object|null} data
 * @param {boolean} [fRepower]
 * @return {boolean} true if successful, false if failure
 */
Mouse.prototype.powerUp = function(data, fRepower) {
    if (!fRepower) {
        if (!data || !this.restore) {
            this.reset();
        } else {
            if (!this.restore(data)) return false;
        }
        if (this.sAdapterType && !this.componentAdapter) {
            var componentAdapter = null;
            while ((componentAdapter = this.cmp.getComponentByType(this.sAdapterType, componentAdapter))) {
                if (componentAdapter.attachMouse) {
                    this.componentAdapter = componentAdapter.attachMouse(this.idAdapter, this);
                    if (this.componentAdapter) {
                        /*
                         * It's possible that the SerialPort we've just attached to might want to bring us "up to speed"
                         * on the adapter's state, which is why I envisioned a subsequent syncMouse() call.  And you would want
                         * to do that as a separate call, not as part of attachMouse(), because componentAdapter isn't
                         * set until attachMouse() returns.
                         * 
                         * However, syncMouse() seems unnecessary, given that SerialPort initializes its MCR to an "inactive"
                         * state, and even when restoring a previous state, if we've done our job properly, both SerialPort and Mouse
                         * should be restored in sync, making any explicit attempt at sync'ing unnecessary (or so I hope). 
                         */
                        // this.componentAdapter.syncMouse();
                        break;
                    }
                }
            }
            if (this.componentAdapter) {
                var componentScreen = this.cmp.getComponentByType("Video");
                if (componentScreen) this.canvasScreen = componentScreen.getCanvas();
            } else {
                this.warning(this.id + ": " + this.sAdapterType + " " + this.idAdapter + " unavailable");
            }
        }
        if (this.fActive) {
            this.captureMouse(this.canvasScreen);
        } else {
            this.releaseMouse(this.canvasScreen);
        }
    }
    return true;
};

/**
 * powerDown(fSave)
 * 
 * @this {Mouse}
 * @param {boolean} fSave
 * @return {Object|boolean}
 */
Mouse.prototype.powerDown = function(fSave) {
    return fSave && this.save ? this.save() : true;
};

/**
 * reset()
 * 
 * @this {Mouse}
 */
Mouse.prototype.reset = function() {
    this.initState();
};

/**
 * save()
 *
 * This implements save support for the Mouse component.
 * 
 * @this {Mouse}
 * @return {Object}
 */
Mouse.prototype.save = function() {
    var state = new State(this);
    state.set(0, this.saveState());
    return state.data();
};

/**
 * restore(data)
 *
 * This implements restore support for the Mouse component.
 * 
 * @this {Mouse}
 * @param {Object} data
 * @return {boolean} true if successful, false if failure
 */
Mouse.prototype.restore = function(data) {
    return this.initState(data[0]);
};

/**
 * initState(data)
 * 
 * @this {Mouse}
 * @param {Array} [data]
 * @return {boolean} true if successful, false if failure
 */
Mouse.prototype.initState = function(data) {
    var i = 0;
    if (data === undefined) data = [false, -1, -1, 0, 0, false, false, 0];
    this.fActive = data[i++];
    this.xMouse = data[i++];
    this.yMouse = data[i++];
    this.xDelta = data[i++];
    this.yDelta = data[i++];
    this.fButton1 = data[i++];      // FYI, we consider button1 to be the LEFT button
    this.fButton2 = data[i++];      // FYI, we consider button2 to be the RIGHT button
    this.bMCR = data[i];
    return true;
};

/**
 * saveState()
 * 
 * @this {Mouse}
 * @return {Array}
 */
Mouse.prototype.saveState = function() {
    var i = 0;
    var data = [];
    data[i++] = this.fActive;
    data[i++] = this.xMouse;
    data[i++] = this.yMouse;
    data[i++] = this.xDelta;
    data[i++] = this.yDelta;
    data[i++] = this.fButton1;
    data[i++] = this.fButton2;
    data[i] = this.bMCR;
    return data;
};

/**
 * captureMouse(control)
 *
 * NOTE: addEventListener() wasn't supported in IE until IE9, but that's OK, because IE9 is the
 * oldest IE we support anyway (since older versions of IE lacked complete HTML5/canvas support).
 * 
 * @this {Mouse}
 * @param {Object} control from the HTML DOM (eg, the canvas for the simulated screen)
 */
Mouse.prototype.captureMouse = function(control) {
    if (control) {
        var mouse = this;
        if (!this.fCaptured) {
            control.addEventListener(
                'mousemove',
                function onMouseMove(event) {
                    mouse.moveMouse(event);
                },
                false               // we'll specify false for the 'useCapture' parameter for now...
            );
            control.addEventListener(
                'mousedown',
                function onMouseDown(event) {
                    mouse.clickMouse(event.button, true);
                },
                false               // we'll specify false for the 'useCapture' parameter for now...
            );
            control.addEventListener(
                'mouseup',
                function onMouseUp(event) {
                    mouse.clickMouse(event.button, false);
                },
                false               // we'll specify false for the 'useCapture' parameter for now...
            );
            this.fCaptured = true;
        }
        /*
         * None of these tricks seemed to work for IE10, so I'm giving up hiding the browser's mouse pointer in IE for now.  
         *
         *      control['style']['cursor'] = "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAZdEVYdFNvZnR3YXJlAFBhaW50Lk5FVCB2My41LjbQg61aAAAADUlEQVQYV2P4//8/IwAI/QL/+TZZdwAAAABJRU5ErkJggg=='), url('/versions/images/current/blank.cur'), none";
         *      
         * Setting the cursor style to "none" may not be a standard, but it works in Safari, Firefox and Chrome, so that's pretty
         * good for a non-standard!
         * 
         * TODO: The reference to '/versions/images/current/blank.cur' is also problematic for anyone who might want
         * to run this app from a different server, so think about that as well.
         */
        control['style']['cursor'] = "none";
    }
};

/**
 * releaseMouse(control)
 *
 * TODO: Use removeEventListener() if fCaptured, to clean up our handlers; since I'm currently using
 * anonymous functions, and since I'm not seeing any compelling reason to remove the handlers once they've
 * been established, it's less code to leave them in place.
 * 
 * @this {Mouse}
 * @param {Object} control from the HTML DOM
 */
Mouse.prototype.releaseMouse = function(control) {
    if (control) {
        control['style']['cursor'] = "auto";
    }
};

/**
 * moveMouse(event)
 *
 * MouseEvent objects contain, among other things, the following properties:
 *
 *      clientX
 *      clientY
 *
 * I've selected the above properties because they're widely supported, not because I need
 * client-area coordinates.  In fact, layerX and layerY are probably closer to what I really want,
 * but I don't think they're available in all browsers.  screenX and screenY would work as well.
 *
 * Anyway, all I care about are deltas.  For now.
 * 
 * @this {Mouse}
 * @param {Object} event object from a 'mousemove' event (specifically, a MouseEvent object)
 */
Mouse.prototype.moveMouse = function(event) {
    if (this.isActive()) {
        if (this.xMouse < 0 || this.yMouse < 0) {
            this.xMouse = event.clientX;
            this.yMouse = event.clientY;
        }
        this.xDelta = event.clientX - this.xMouse;
        this.yDelta = event.clientY - this.yMouse;
        if (this.xDelta || this.yDelta) {
            this.sendPacket(null, event.clientX, event.clientY);
        }
        this.xMouse = event.clientX;
        this.yMouse = event.clientY;
    }
};

/**
 * clickMouse(iButton, fDown)
 * 
 * @this {Mouse}
 * @param {number} iButton is 0 for fButton1 (the LEFT button), 2 for fButton2 (the RIGHT button)
 * @param {boolean} fDown
 */
Mouse.prototype.clickMouse = function(iButton, fDown) {
    if (this.isActive()) {
        var sDiag;
        switch (iButton) {
        case 0:
            if (this.fButton1 != fDown) {
                this.fButton1 = fDown;
                sDiag = DEBUGGER ? ("mouse button1 " + (fDown ? "dn" : "up")) : null;
                this.sendPacket(sDiag);
            }
            break;
        case 2:
            if (this.fButton2 != fDown) {
                this.fButton2 = fDown;
                sDiag = DEBUGGER ? ("mouse button2 " + (fDown ? "dn" : "up")) : null;
                this.sendPacket(sDiag);
            }
            break;
        default:
            break;
        }
    }
};

/**
 * sendPacket(sDiag, xDiag, yDiag)
 *
 * If we're called, something changed.
 *
 * Let's review the 3-byte packet format:
 *
 *              D7  D6  D5  D4  D3  D2  D1  D0
 *      Byte 1  X   1   LB  RB  Y7  Y6  X7  X6
 *      Byte 2  X   0   X5  X4  X3  X2  X1  X0
 *      Byte 3  X   0   Y5  Y4  Y3  Y2  Y1  Y0
 * 
 * @this {Mouse}
 * @param {string|null} [sDiag] diagnostic message
 * @param {number} [xDiag] original x-coordinate (optional; for diagnostic use only)
 * @param {number} [yDiag] original y-coordinate (optional; for diagnostic use only)
 */
Mouse.prototype.sendPacket = function(sDiag, xDiag, yDiag) {
    var b1 = 0x40 | (this.fButton1 ? 0x20 : 0) | (this.fButton2 ? 0x10 : 0) | ((this.yDelta & 0xC0) >> 4) | ((this.xDelta & 0xC0) >> 6);
    var b2 = this.xDelta & 0x3F;
    var b3 = this.yDelta & 0x3F;
    this.messageDebugger((sDiag ? (sDiag + ": ") : "") + (yDiag !== undefined ? ("mouse (" + xDiag + "," + yDiag + "): ") : "") + "serial packet [" + str.toHexByte(b1) + "," + str.toHexByte(b2) + "," + str.toHexByte(b3) + "]");
    this.componentAdapter.sendRBR([b1, b2, b3]);
    this.xDelta = this.yDelta = 0;
};

/**
 * notifyMCR(bMCR)
 *
 * The SerialPort notifies us whenever SerialPort.MCR.DTR or SerialPort.MCR.RTS changes.
 *
 * During normal serial mouse operation, both RTS and DTR must be "positive".
 *
 * Setting RTS "negative" for 100ms resets the mouse.  Toggling DTR requests an identification byte (0x4D).
 *
 * NOTES: The above 3rd-party information notwithstanding, I've observed that Windows v1.01 initially writes 0x01
 * to the MCR (DTR on, RTS off), spins in a loop that reads the RBR (probably to avoid a bogus identification byte
 * sitting in the RBR), and then writes 0x0B to the MCR (DTR on, RTS on).  This last step is consistent with making
 * the mouse "active", but it is NOT consistent with "toggling DTR", so I conclude that a reset is ALSO sufficient
 * for sending the identification byte.  Right or wrong, this gets the ball rolling for Windows v1.01.
 * 
 * @this {Mouse}
 * @param {number} bMCR
 */
Mouse.prototype.notifyMCR = function(bMCR) {
    var fActive = ((bMCR & (SerialPort.MCR.DTR | SerialPort.MCR.RTS)) == (SerialPort.MCR.DTR | SerialPort.MCR.RTS));
    if (fActive) {
        if (!this.fActive) {
            var fIdentify = false;
            if (!(this.bMCR & SerialPort.MCR.RTS)) {
                this.reset();
                this.messageDebugger("serial mouse reset");
                fIdentify = true;
            }
            if (!(this.bMCR & SerialPort.MCR.DTR)) {
                this.messageDebugger("serial mouse ID requested");
                fIdentify = true;
            }
            if (fIdentify) {
                this.componentAdapter.sendRBR([0x4D]);
                this.messageDebugger("serial mouse ID sent");
            }
            this.captureMouse(this.canvasScreen);
            this.fActive = fActive;
        }
    } else {
        if (this.fActive) {
            /*
             * Although this would seem nice (ie, for the Windows v1.01 mouse driver to turn RTS off when its mouse
             * driver shuts down and Windows exits, since it DID turn RTS on), that doesn't appear to actually happen.
             * At the very least, Windows will have (re)masked the serial port's IRQ, so what does it matter?  Not much,
             * I just would have preferred that fActive properly reflect whether we should continue dispatching mouse
             * events, displaying MESSAGE_MOUSE messages, etc.
             * 
             * We could ask the ChipSet component to notify the SerialPort component whenever its IRQ is masked/unmasked,
             * and then have the SerialPort pass that notification on to us, but I'm assuming that in the real world,
             * a mouse device that's still powered may still send event data to the serial port, and if there was software
             * polling the serial port, it might expect to see that data.  Unlikely, but not impossible.
             */
            this.messageDebugger("serial mouse inactive");
            this.releaseMouse(this.canvasScreen);
            this.fActive = fActive;
        }
    }
    this.bMCR = bMCR;
};

/**
 * messageDebugger(sMessage)
 *
 * This is a combination of the Debugger's messageEnabled(MESSAGE_MOUSE) and message() functions, for convenience.
 * 
 * @this {Mouse}
 * @param {string} sMessage is any caller-defined message string
 */
Mouse.prototype.messageDebugger = function(sMessage) {
    if (DEBUGGER && this.dbg) {
        if (this.dbg.messageEnabled(this.dbg.MESSAGE_MOUSE)) {
            this.dbg.message(sMessage);
        }
    }
};

/**
 * Mouse.init()
 *
 * This function operates on every element (e) of class "mouse", and initializes
 * all the necessary HTML to construct the Mouse module(s) as spec'ed.
 *
 * Note that each element (e) of class "mouse" is expected to have a "data-value"
 * attribute containing the same JSON-encoded parameters that the Mouse constructor
 * expects.
 */
Mouse.init = function() {
    var aeMouse = Component.getElementsByClass(window.document, PCJSCLASS, "mouse");
    for (var iMouse = 0; iMouse < aeMouse.length; iMouse++) {
        var eMouse = aeMouse[iMouse];
        var parmsMouse = Component.getComponentParms(eMouse);
        var mouse = new Mouse(parmsMouse);
        Component.bindComponentControls(mouse, eMouse, PCJSCLASS);
    }
};

/*
 * Initialize every Mouse module on the page.
 */
web.onInit(Mouse.init);

if (typeof APP_PCJS !== 'undefined') APP_PCJS.Mouse = Mouse;

if (typeof module !== 'undefined') module.exports = Mouse;