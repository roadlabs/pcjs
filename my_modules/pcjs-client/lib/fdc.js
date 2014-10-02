/**
 * @fileoverview Implements the PCjs Floppy Drive Controller (FDC) component.
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a>
 * @version 1.0
 * @suppress {missingProperties}
 * Created 2012-Aug-09
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
    var DiskAPI = require("../../shared/lib/diskapi");
    var Component = require("../../shared/lib/component");
    var ChipSet = require("./chipset");
    var Disk = require("./disk");
    var Computer = require("./computer");
    var State = require("./state");
}

/**
 * FDC(parmsFDC)
 *
 * The FDC component simulates an NEC PD765A, and has one component-specific property:
 *
 *      autoMount: one or more JSON-encoded objects, each containing 'name' and 'path' properties
 *
 * Regarding early diskette drives: the IBM PC Model 5150 originally shipped with single-sided drives,
 * and therefore supported only 160Kb diskettes.  That's the only diskette format PC-DOS 1.00 supported, too.
 *
 * At some point, 5150's started shipping with double-sided drives, but I'm not sure whether the ROMs changed;
 * they probably did NOT change, because the original ROM BIOS already supported drives with multiple heads.
 * However, what the ROM BIOS did NOT do was provide any indication of drive type, which as far as I can tell,
 * meant you had to simply read/write/format tracks with the second head and check for errors.
 *
 * Presumably at the same time double-sided drives started shipping, PC-DOS 1.10 shipped, which added
 * support for 320Kb diskettes.  And the FORMAT command changed as well, defaulting to a double-sided format
 * operation UNLESS you specified "FORMAT /1".  If I run PC-DOS 1.10 and try to simulate a single-sided drive
 * (by setting drive.nHeads = 1 in initDrive), FORMAT will balk with "Track 0 bad - disk unusable".  I have to
 * wonder if everyone with single-sided drives who upgraded to PC-DOS 1.10 also got that error, forcing them
 * to always specify "FORMAT /1", or if I'm doing something wrong wrt single-sided drive simulation.
 *
 * I've noticed that if I turn FDC messages on ("m fdc on"), and then run "FORMAT B:/1", the command still
 * tries to format head 1/track 0, followed by head 0/track 0, and then the FDC is reset, and the format operation
 * proceeds with only head 0 for all tracks 0 through 39.  FORMAT successfully creates a 160Kb single-sided diskette,
 * but why it also tries to initially format track 0 using the second head remains a bit of a mystery.
 *
 * @constructor
 * @extends Component
 * @param {Object} parmsFDC
 */
function FDC(parmsFDC) {
    /*
     * TODO: Indicate the type of diskette image being loaded (this might help folks understand what's going
     * on when they try to load a diskette image that's larger than what the selected operating system supports).
     */
    Component.call(this, "FDC", parmsFDC, FDC);

    this['dmaRead'] = this.dmaRead;
    this['dmaWrite'] = this.dmaWrite;
    this['dmaFormat'] = this.dmaFormat;

    this.pAutoMount = null;
    if (parmsFDC['autoMount']) {
        this.pAutoMount = parmsFDC['autoMount'];
        if (typeof this.pAutoMount == "string") {
            try {
                /*
                 * The most likely source of any exception will be right here, where we're parsing
                 * the JSON-encoded diskette data.
                 */
                this.pAutoMount = eval("(" + parmsFDC['autoMount'] + ")");
            } catch (e) {
                this.error("FDC auto-mount error: " + e.message + " (" + parmsFDC['autoMount'] + ")");
                this.pAutoMount = null;
            }
        }
    }

    /*
     * The following array keeps track of every disk image we've ever mounted.  Each entry in the
     * array is another array whose elements are:
     * 
     *      [0]: name of disk
     *      [1]: path of disk
     *      [2]: array of deltas, uninitialized until the disk is unmounted and/or all state is saved
     *      
     * See functions addDiskHistory() and updateDiskHistory().
     */
    this.aDiskHistory = [];

    /*
     * If we didn't need auto-mount support, we could defer controller initialization until we received a powerUp() notification,
     * at which point reset() would call initController(), or restore() would restore the controller; in that case, all we'd need
     * to do here is call setReady().
     */
    this.initController();

    if (!this.autoMount()) this.setReady();
}

Component.subclass(Component, FDC);

/*
 * FDC BIOS interrupts, functions, and other parameters
 */
FDC.BIOS = {};
FDC.BIOS.DISKETTE_INT = 0x13;

FDC.DEFAULT_DRIVE_NAME = "Floppy Drive";

/*
 * FDC Output Register (0x3F2, write-only)
 * 
 * NOTE: A drive's MOTOR bit must be ON before the the drive can be selected.  Motor start time is 500ms.
 * 
 * On the MODEL_5170 "PC AT Fixed Disk and Diskette Drive Adapter", this port is called the Digital Output Register
 * or DOR.  It uses the same bit definitions as the original FDC Output Register, except that only two diskette drives
 * are supported, hence bit 1 is always 0 (FDC.REG_OUTPUT.SELECT_C and FDC.REG_OUTPUT.SELECT_D are not supported)
 * and bits 6 and 7 are unused (FDC.REG_OUTPUT.MOTOR_C and FDC.REG_OUTPUT.MOTOR_D are not supported).
 */
FDC.REG_OUTPUT = {};
FDC.REG_OUTPUT.PORT         = 0x3F2;
FDC.REG_OUTPUT.SELECT       = 0x03;
FDC.REG_OUTPUT.SELECT_A     = 0x00;
FDC.REG_OUTPUT.SELECT_B     = 0x01;
FDC.REG_OUTPUT.SELECT_C     = 0x02;     // reserved on the MODEL_5170
FDC.REG_OUTPUT.SELECT_D     = 0x03;     // reserved on the MODEL_5170
FDC.REG_OUTPUT.ENABLE       = 0x04;     // clearing this bit resets the FDC
FDC.REG_OUTPUT.INT_ENABLE   = 0x08;     // enables both FDC and DMA (Channel 2) interrupt requests (IRQ 6)
FDC.REG_OUTPUT.MOTOR_A      = 0x10;
FDC.REG_OUTPUT.MOTOR_B      = 0x20;
FDC.REG_OUTPUT.MOTOR_C      = 0x40;     // reserved on the MODEL_5170
FDC.REG_OUTPUT.MOTOR_D      = 0x80;     // reserved on the MODEL_5170

/*
 * FDC Main Status Register (0x3F4, read-only)
 * 
 * On the MODEL_5170 "PC AT Fixed Disk and Diskette Drive Adapter", bits 2 and 3 are reserved, since that adapter
 * supported a maximum of two diskette drives.
 */
FDC.REG_STATUS = {};
FDC.REG_STATUS.PORT         = 0x3F4;
FDC.REG_STATUS.BUSY_A       = 0x01;
FDC.REG_STATUS.BUSY_B       = 0x02;
FDC.REG_STATUS.BUSY_C       = 0x04;     // reserved on the MODEL_5170
FDC.REG_STATUS.BUSY_D       = 0x08;     // reserved on the MODEL_5170
FDC.REG_STATUS.BUSY         = 0x10;     // a read or write command is in progress
FDC.REG_STATUS.NON_DMA      = 0x20;     // FDC is in non-DMA mode
FDC.REG_STATUS.READ_DATA    = 0x40;     // transfer is from FDC Data Register to processor (if clear, then transfer is from processor to the FDC Data Register)
FDC.REG_STATUS.RQM          = 0x80;     // indicates FDC Data Register is ready to send or receive data to or from the processor (Request for Master)

/*
 * FDC Data Register (0x3F5, read-write)
 */
FDC.REG_DATA = {};
FDC.REG_DATA.PORT           = 0x3F5;

/*
 * FDC Digital Input Register (0x3F7, read-only, MODEL_5170 only)
 * 
 * Bit 7 indicates a diskette change (the MODEL_5170 introduced change-line support).  Bits 0-6 are for the selected
 * hard disk drive, so this port must be shared with the HDC; bits 0-6 are valid for 50 microseconds after a write to
 * the Drive Head Register.
 */
FDC.REG_INPUT = {};
FDC.REG_INPUT.PORT          = 0x3F7;
FDC.REG_INPUT.DS0           = 0x01;     // Drive Select 0
FDC.REG_INPUT.DS1           = 0x02;     // Drive Select 1
FDC.REG_INPUT.HS0           = 0x04;     // Head Select 0
FDC.REG_INPUT.HS1           = 0x08;     // Head Select 1
FDC.REG_INPUT.HS2           = 0x10;     // Head Select 2
FDC.REG_INPUT.HS3           = 0x20;     // Head Select 3
FDC.REG_INPUT.WRITE_GATE    = 0x40;     // Write Gate
FDC.REG_INPUT.DISK_CHANGE   = 0x80;     // Diskette Change

/*
 * FDC Diskette Control Register (0x3F7, write-only, MODEL_5170 only)
 * 
 * Only bits 0-1 are used; bits 2-7 are reserved.
 */
FDC.REG_CONTROL = {};
FDC.REG_CONTROL.PORT        = 0x3F7;
FDC.REG_CONTROL.RATE500K    = 0x00;     // 500,000 bps
FDC.REG_CONTROL.RATE300K    = 0x02;     // 300,000 bps
FDC.REG_CONTROL.RATE250K    = 0x01;     // 250,000 bps
FDC.REG_CONTROL.RATEUNUSED  = 0x03;

/*
 * FDC Commands
 * 
 * NOTE: FDC command bytes need to be masked with FDC.REG_DATA.CMD.MASK before comparing to the values below, since a
 * number of commands use the following additional bits as follows:
 *  
 *      SK (0x20): Skip Deleted Data Address Mark
 *      MF (0x40): Modified Frequency Modulation (as opposed to FM or Frequency Modulation)
 *      MT (0x80): multi-track operation (ie, data processed under both head 0 and head 1)
 *      
 * We don't support MT (Multi-Track) operations at this time, and the MF and SK designations cannot be supported as long
 * as our diskette images contain only the original data bytes without any formatting information.
 */
FDC.REG_DATA.CMD = {};
FDC.REG_DATA.CMD.READ_TRACK     = 0x02;
FDC.REG_DATA.CMD.SPECIFY        = 0x03;
FDC.REG_DATA.CMD.DRIVE_STATUS   = 0x04;
FDC.REG_DATA.CMD.WRITE_DATA     = 0x05;
FDC.REG_DATA.CMD.READ_DATA      = 0x06;
FDC.REG_DATA.CMD.RECALIBRATE    = 0x07;
FDC.REG_DATA.CMD.INT_STATUS     = 0x08;     // this command is used to clear the FDC interrupt following the clearing/setting of FDC.REG_OUTPUT.ENABLE
FDC.REG_DATA.CMD.WRITE_DEL_DATA = 0x09;
FDC.REG_DATA.CMD.READ_ID        = 0x0A;
FDC.REG_DATA.CMD.READ_DEL_DATA  = 0x0C;
FDC.REG_DATA.CMD.FORMAT_TRACK   = 0x0D;
FDC.REG_DATA.CMD.SEEK           = 0x0F;
FDC.REG_DATA.CMD.SCAN_EQUAL     = 0x11;
FDC.REG_DATA.CMD.SCAN_LO_EQUAL  = 0x19;
FDC.REG_DATA.CMD.SCAN_HI_EQUAL  = 0x1D;
FDC.REG_DATA.CMD.MASK           = 0x1F;
FDC.REG_DATA.CMD.SK             = 0x20;     // SK (Skip Deleted Data Address Mark)
FDC.REG_DATA.CMD.MF             = 0x40;     // MF (Modified Frequency Modulation)
FDC.REG_DATA.CMD.MT             = 0x80;     // MT (Multi-Track; ie, data under both heads will be processed)

/*
 * FDC error conditions, generally assigned according to the corresponding ST0, ST1 or ST2 error bit.
 */
FDC.REG_DATA.ERR = {};
FDC.REG_DATA.ERR.NONE           = 0x000000; // ST0 (IC): Normal termination of command (NT)
FDC.REG_DATA.ERR.NOT_READY      = 0x000008; // ST0 (NR): When the FDD is in the not-ready state and a read or write command is issued, this flag is set; if a read or write command is issued to side 1 of a single sided drive, then this flag is set
FDC.REG_DATA.ERR.EQUIP_CHECK    = 0x000010; // ST0 (EC): If a fault signal is received from the FDD, or if the track 0 signal fails to occur after 77 step pulses (recalibrate command), then this flag is set
FDC.REG_DATA.ERR.SEEK_END       = 0x000020; // ST0 (SE): When the FDC completes the Seek command, this flag is set to 1 (high)
FDC.REG_DATA.ERR.INCOMPLETE     = 0x000040; // ST0 (IC): Abnormal termination of command (AT); execution of command was started, but was not successfully completed
FDC.REG_DATA.ERR.RESET          = 0x0000C0; // ST0 (IC): Abnormal termination because during command execution the ready signal from FOO changed state
FDC.REG_DATA.ERR.INVALID        = 0x000080; // ST0 (IC): Invalid command issue (IC); command which was issued was never started
FDC.REG_DATA.ERR.ST0            = 0x0000FF;
FDC.REG_DATA.ERR.NO_ID_MARK     = 0x000100; // ST1 (MA): If the FDC cannot detect the ID Address Mark, this flag is set; at the same time, the MD (Missing Address Mark in Data Field) of Status Register 2 is set
FDC.REG_DATA.ERR.NOT_WRITABLE   = 0x000200; // ST1 (NW): During Execution of a Write Data, Write Deleted Data, or Format a Cylinder command, if the FDC detects a write protect signal from the FDD, then this flag is set
FDC.REG_DATA.ERR.NO_DATA        = 0x000400; // ST1 (ND): FDC cannot find specified sector (or specified ID if READ_ID command)
FDC.REG_DATA.ERR.DMA_OVERRUN    = 0x001000; // ST1 (OR): If the FDC is not serviced by the main systems during data transfers within a certain time interval, this flag is set
FDC.REG_DATA.ERR.CRC_ERROR      = 0x002000; // ST1 (DE): When the FDC detects a CRC error in either the ID field or the data field, this flag is set
FDC.REG_DATA.ERR.END_OF_CYL     = 0x008000; // ST1 (EN): When the FDC tries to access a sector beyond the final sector of a cylinder, this flag is set
FDC.REG_DATA.ERR.ST1            = 0x00FF00;
FDC.REG_DATA.ERR.NO_DATA_MARK   = 0x010000; // ST2 (MD): When data is read from the medium, if the FDC cannot find a Data Address Mark or Deleted Data Address Mark, then this flag is set
FDC.REG_DATA.ERR.BAD_CYL        = 0x020000; // ST2 (BC): This bit is related to the ND bit, and when the contents of C on the medium are different from that stored in the ID Register, and the content of C is FF, then this flag is set
FDC.REG_DATA.ERR.SCAN_FAILED    = 0x040000; // ST2 (SN): During execution of the Scan command, if the FDC cannot find a sector on the cylinder which meets the condition, then this flag is set
FDC.REG_DATA.ERR.SCAN_EQUAL     = 0x080000; // ST2 (SH): During execution of the Scan command, if the condition of "equal" is satisfied, this flag is set
FDC.REG_DATA.ERR.WRONG_CYL      = 0x100000; // ST2 (WC): This bit is related to the ND bit, and when the contents of C on the medium are different from that stored in the ID Register, this flag is set
FDC.REG_DATA.ERR.DATA_FIELD     = 0x200000; // ST2 (DD): If the FDC detects a CRC error in the data, then this flag is set
FDC.REG_DATA.ERR.STRL_MARK      = 0x400000; // ST2 (CM): During execution of the Read Data or Scan command, if the FDC encounters a sector which contains a Deleted Data Address Mark, this flag is set
FDC.REG_DATA.ERR.ST2            = 0xFF0000;

/*
 * FDC Command Sequences
 * 
 * For each command, cbWrite indicates the total number of bytes in the command request sequence,
 * including the first (command) byte; cbRead indicates total number of bytes in the response sequence.
 */
FDC.aCmdSeqs = {
    0x03: {cbWrite: 3, cbRead: 0, name: "SPECIFY"},
    0x04: {cbWrite: 2, cbRead: 1, name: "DRIVE_STATUS"},
    0x05: {cbWrite: 9, cbRead: 7, name: "WRITE_DATA"},
    0x06: {cbWrite: 9, cbRead: 7, name: "READ_DATA"},
    0x07: {cbWrite: 2, cbRead: 0, name: "RECALIBRATE"},
    0x08: {cbWrite: 1, cbRead: 2, name: "INT_STATUS"},
    0x0D: {cbWrite: 6, cbRead: 7, name: "FORMAT"},
    0x0F: {cbWrite: 3, cbRead: 0, name: "SEEK"}
};

/**
 * setBinding(sHTMLClass, sHTMLType, sBinding, control)
 *
 * @this {FDC}
 * @param {string|null} sHTMLClass is the class of the HTML control (eg, "input", "output")
 * @param {string|null} sHTMLType is the type of the HTML control (eg, "button", "list", "text", "submit", "textarea", "canvas")
 * @param {string} sBinding is the value of the 'binding' parameter stored in the HTML control's "data-value" attribute (eg, "listDisks")
 * @param {Object} control is the HTML control DOM object (eg, HTMLButtonElement)
 * @return {boolean} true if binding was successful, false if unrecognized binding request
 */
FDC.prototype.setBinding = function(sHTMLClass, sHTMLType, sBinding, control)
{
    switch (sBinding) {
        case "listDisks":
            this.bindings[sBinding] = control;
            /*
             * Add the special path of "?" to the list, which will prompt the user for a URL.
             */
            var controlOption = window.document.createElement("option");
            controlOption['value'] = "?";
            controlOption.innerHTML = "User-defined URL...";
            control.appendChild(controlOption);
            /*
             * Now add an 'onchange' handler.
             */
            control.onchange = function(fdc, controlDisks) {
                return function onChangeListDisks() {
                    var controlDesc = fdc.bindings["descDisk"];
                    if (controlDesc) {
                        var controlOption = controlDisks.options[controlDisks.selectedIndex];
                        if (controlOption) {
                            var dataValue = {};
                            var sValue = controlOption.getAttribute("data-value");
                            if (sValue) {
                                try {
                                    dataValue = eval("({" + sValue + "})");
                                } catch (e) {
                                    fdc.error("FDC option error: " + (e.message || e));
                                }
                            }
                            var sDesc = dataValue['desc'];
                            if (sDesc === undefined) sDesc = "";
                            var sHRef = dataValue['href'];
                            if (sHRef !== undefined) sDesc = "<a href=\"" + sHRef + "\" target=\"_blank\">" + sDesc + "</a>";
                            controlDesc.innerHTML = sDesc;
                        }
                    }
                };
            }(this, control);
            return true;
    
        case "descDisk":
        case "listDrives":
            this.bindings[sBinding] = control;
            /*
             * I tried going with onclick instead of onchange, so that if you wanted to confirm what's
             * loaded in a particular drive, you could click the drive control without having to change it.
             * However, that doesn't seem to work for all browsers, so I've reverted to onchange.
             */
            control.onchange = function(fdc, controlDrives) {
                return function onChangeListDrives() {
                    var iDrive = parseInt(controlDrives.value, 10);
                    if (!isNaN(iDrive)) fdc.displayDiskette(iDrive);
                };
            }(this, control);
            return true;
    
        case "loadDrive":
            this.bindings[sBinding] = control;
            control.onclick = function(fdc) {
                return function onClickLoadDrive() {
                    var iDrive;
                    var controlDisks = fdc.bindings["listDisks"];
                    var controlDrives = fdc.bindings["listDrives"];
                    if (controlDisks && controlDrives && !isNaN(iDrive = parseInt(controlDrives.value, 10)) && iDrive >= 0 && iDrive < fdc.aDrives.length) {
                        var sDiskettePath = controlDisks.value;
                        if (!sDiskettePath) {
                            fdc.unloadDrive(iDrive);
                            return;
                        }
                        var sDisketteName = controlDisks.options[controlDisks.selectedIndex].text;
                        
                        /*
                         * If the special path of "?" is selected, then we want to prompt the user for a URL.  Oh, and
                         * make sure we pass an empty string as the 2nd parameter to prompt(), so that IE won't display
                         * "undefined" -- because after all, undefined and "undefined" are EXACTLY the same thing, right?
                         *
                         * TODO: This is literally all I've done to support external disk images. There's probably more
                         * I should do, like dynamically updating "listDisks" to include new entries, and adding new entries
                         * to the save/restore data.
                         */
                        if (sDiskettePath == "?") {
                            sDiskettePath = window.prompt("Enter the URL of a disk image to load.", "");
                            if (!sDiskettePath)
                                return;
                            sDisketteName = str.getBaseName(sDiskettePath);
                            fdc.println("Attempting to load " + sDiskettePath + " as \"" + sDisketteName + "\"");
                        }
                        
                        while (fdc.loadDiskette(iDrive, sDisketteName, sDiskettePath, false)) {
                            if (!window.confirm("Click OK to reload the original disk.\n(WARNING: All disk changes will be discarded)")) {
                                return;
                            }
                            /*
                             * So here's the story: loadDiskette() returned true, which it does ONLY if the specified disk is already
                             * mounted, AND the user clicked OK to reload the original disk image.  So we must toss any history we have
                             * for the disk, unload it, and then loop back around to loadDiskette().
                             *
                             * loadDiskette() should NEVER return true the second time, since no disk is loaded. In other words, this
                             * isn't really a loop so much as a one-time retry operation.
                             */
                            fdc.removeDiskHistory(sDisketteName, sDiskettePath);
                            fdc.unloadDrive(iDrive, false, true);
                        }
                        return;
                    }
                    fdc.notice("Nothing to load");
                };
            }(this);
            return true;

        default:
            break;
    }
    return false;
};

/**
 * initBus(cmp, bus, cpu, dbg)
 *
 * @this {FDC}
 * @param {Computer} cmp
 * @param {Bus} bus
 * @param {X86CPU} cpu
 * @param {Debugger} dbg
 */
FDC.prototype.initBus = function(cmp, bus, cpu, dbg)
{
    this.bus = bus;
    this.cpu = cpu;
    this.dbg = dbg;
    this.cmp = cmp;

    this.chipset = cmp.getComponentByType("ChipSet");

    bus.addPortInputTable(this, FDC.aPortInput);
    bus.addPortOutputTable(this, FDC.aPortOutput);
    if (DEBUGGER) cpu.addInterruptNotify(FDC.BIOS.DISKETTE_INT, this, this.intBIOSDiskette);
};

/**
 * powerUp(data, fRepower)
 *
 * @this {FDC}
 * @param {Object|null} data
 * @param {boolean} [fRepower]
 * @return {boolean} true if successful, false if failure
 */
FDC.prototype.powerUp = function(data, fRepower)
{
    if (!fRepower) {
        if (!data || !this.restore) {
            this.reset();
            if (this.cmp.fReload) {
                /*
                 * If the computer's fReload flag is set, we're required to toss all currently
                 * loaded disks and remount all disks specified in the auto-mount configuration. 
                 */
                this.unloadAllDrives(true);
                this.autoMount(true);
            }
        } else {
            if (!this.restore(data)) return false;
        }
        if (this.chipset) {
            this.nDrives = this.chipset.getSW1FloppyDrives();
            /*
             * Now that we finally have the SW1 settings, we can populate the HTML control
             * to match the actual (well, um, specified) number of floppy drives in the system.
             */
            var controlDrives;
            if ((controlDrives = this.bindings['listDrives'])) {
                while (controlDrives.firstChild) {
                    controlDrives.removeChild(controlDrives.firstChild);
                }
                controlDrives.innerHTML = "";
                for (var iDrive = 0; iDrive < this.nDrives; iDrive++) {
                    var controlOption = window.document.createElement("option");
                    controlOption['value'] = iDrive;
                    /*
                     * TODO: This conversion of drive number to drive letter, starting with A:, is very simplistic
                     * and will NOT match the drive mappings that DOS ultimately uses.  We'll need to spiff this up at
                     * some point.
                     */
                    controlOption.innerHTML = String.fromCharCode(0x41 + iDrive) + ":";
                    controlDrives.appendChild(controlOption);
                }
                if (this.nDrives > 0) {
                    controlDrives.value = "0";
                    this.displayDiskette(0);
                }
            }
        }
    }
    return true;
};

/**
 * powerDown(fSave)
 *
 * @this {FDC}
 * @param {boolean} fSave
 * @return {Object|boolean}
 */
FDC.prototype.powerDown = function(fSave)
{
    return fSave && this.save ? this.save() : true;
};

/**
 * reset()
 *
 * NOTE: initController() establishes the maximum possible number of drives, but it's not until
 * we interrogate the current SW1 settings that we will have an ACTUAL number of drives (nDrives),
 * at which point we can also update the contents of the "listDrives" HTML control, if any.
 *
 * @this {FDC}
 */
FDC.prototype.reset = function()
{
    /*
     * NOTE: The controller is also initialized by the constructor, to assist with auto-mount support,
     * so think about whether we can skip powerUp initialization.
     */
    this.initController();
};

/**
 * save()
 *
 * This implements save support for the FDC component.
 *
 * @this {FDC}
 * @return {Object}
 */
FDC.prototype.save = function()
{
    var state = new State(this);
    state.set(0, this.saveController());
    return state.data();
};

/**
 * restore(data)
 *
 * This implements restore support for the FDC component.
 *
 * @this {FDC}
 * @param {Object} data
 * @return {boolean} true if successful, false if failure
 */
FDC.prototype.restore = function(data)
{
    return this.initController(data[0]);
};

/**
 * initController(data)
 *
 * @this {FDC}
 * @param {Array} [data]
 * @return {boolean} true if successful, false if failure
 */
FDC.prototype.initController = function(data)
{
    var i = 0;
    var fSuccess = true;
    
    if (data === undefined) {
        data = [0, 0, FDC.REG_STATUS.RQM, new Array(9), 0, 0, 0, []];
    }
    
    /*
     * Selected drive (from reOutput), which can only be selected if its motor is on (see regOutput).
     */
    this.iDrive = data[i++];
    /*
     * FDC commands select a unit, which I assume should always match the selected drive, but since they're
     * independent, we'll use independent variables.
     */
    this.iUnit = data[i++];
    /*
     * Defaults to FDC.REG_STATUS.RQM set (ready for command) and FDC.REG_STATUS.READ_DATA clear (data direction
     * is from processor to the FDC Data Register).
     */
    this.regStatus = data[i++];
    /*
     * There can be up to 9 command bytes, and 7 result bytes, so 9 data registers are sufficient for communicating
     * in both directions (hence, the new Array(9) default above).
     */
    this.regDataArray = data[i++];
    /*
     * Determines the next data byte to be received.
     */
    this.regDataIndex = data[i++];
    /*
     * Determines the next data byte to be sent (internally, we use regDataIndex to read data bytes, up to this total).
     */
    this.regDataTotal = data[i++];
    this.regOutput = data[i++];
    var dataDrives = data[i++];

    /*
     * Initialize the disk history (if available) before initializing the drives,
     * so that any disk deltas can be applied to disk images that are already loaded. 
     */
    var aDiskHistory = data[i++];
    if (aDiskHistory != null) this.aDiskHistory = aDiskHistory;

    /*
     * We allocate the maximum number of drives; we won't know the actual number of drives until we're able to query
     * the SW1 switch settings.
     */
    if (this.aDrives === undefined) {
        this.aDrives = new Array(4);
    }
    for (var iDrive = 0; iDrive < this.aDrives.length; iDrive++) {
        if (this.aDrives[iDrive] === undefined) {
            this.aDrives[iDrive] = {};
        }
        var drive = this.aDrives[iDrive];
        if (!this.initDrive(drive, iDrive, dataDrives[iDrive])) {
            fSuccess = false;
        }
    }
    
    /*
     * regInput and regControl (port 0x3F7) were not present on controllers prior to MODEL_5170, which is why
     * we don't include initializers for them in the default data array; we could eliminate them on older models,
     * but we don't have access to the model info right now, and there's no real cost to always including them
     * in the FDC state.
     * 
     * The bigger compatibility question is whether to always include hooks for them (see aPortInput and aPortOutput).
     */
    this.regInput = data[i++] || 0;                             // TODO: Determine if we should default to FDC.REG_INPUT.DISK_CHANGE instead of 0
    this.regControl = data[i] || FDC.REG_CONTROL.RATE500K;      // default to maximum data rate

    if (DEBUG) this.messageDebugger("FDC initialized for " + this.aDrives.length + " drive(s)");
    return fSuccess;
};

/**
 * saveController()
 *
 * @this {FDC}
 * @return {Array}
 */
FDC.prototype.saveController = function()
{
    var i = 0;
    var data = [];
    data[i++] = this.iDrive;
    data[i++] = this.iUnit;
    data[i++] = this.regStatus;
    data[i++] = this.regDataArray;
    data[i++] = this.regDataIndex;
    data[i++] = this.regDataTotal;
    data[i++] = this.regOutput;
    data[i++] = this.saveDrives();
    data[i++] = this.saveDeltas();
    data[i++] = this.regInput;
    data[i] = this.regControl;
    return data;
};

/**
 * initDrive(drive, iDrive, data)
 *
 * @this {FDC}
 * @param {Object} drive
 * @param {number} iDrive
 * @param {Array|undefined} data
 * @return {boolean} true if successful, false if failure
 */
FDC.prototype.initDrive = function(drive, iDrive, data)
{
    var i = 0;
    var fSuccess = true;
    
    drive.iDrive = iDrive;

    if (data === undefined) {
        /*
         * We set a default of two heads (MODEL_5150 PCs originally shipped with single-sided drives only,
         * but the ROM BIOS appears to have always supported both drive types).
         */
        data = [FDC.REG_DATA.ERR.RESET, true, 0, 2, 0];
    }

    if (typeof data[1] == "boolean") {
        data[1] = [FDC.DEFAULT_DRIVE_NAME, 40, data[3], 9, 512, data[1]];
    }
    
    /*
     * errorCode used to be an FDC global, but in order to insulate FDC state from the operation of various functions that operate on drive
     * objects (eg, readByte and writeByte), I've made it a per-drive variable.  This choice, similar to my choice for handling PCN, is
     * probably contrary to how the actual hardware works, but I prefer this approach, as long as it doesn't expose any incompatibilities that
     * any software actually cares about.
     */
    drive.errorCode = data[i++];
    
    /*
     * Some additional drive properties/defaults that are largely for the Disk component's benefit.
     */
    drive.name = data[i][0];
    drive.nCylinders = data[i][1];          // cylinders
    drive.nHeads = data[i][2];              // heads/cylinders              
    drive.nSectors = data[i][3];            // sectors/track
    drive.cbSector = data[i][4];            // bytes/sector
    drive.fRemovable = data[i][5];
    i++;

    /*
     * The next group of properties are set by various FDC command sequences.
     *
     * We initialize this.iDrive (above) and drive.bHead and drive.bCylinder (below) to zero, but leave the rest undefined,
     * awaiting their first FDC command.  We do this because the initial INT_STATUS command returns a PCN, which will also
     * be undefined unless we have at least zeroed both the current drive and the "present" cylinder on that drive.
     * 
     * Alternatively, I could make PCN a global FDC variable.  That's probably closer to how the actual hardware operates,
     * but I'm eschewing global FDC variables so that the FDC component can be a good client to both the CPU and other components. 
     */
    drive.bHead = data[i++];
    i++;                                    // skip the data[] slot where we used to store drive.nHeads (no longer used)
    drive.bCylinder = data[i++];
    drive.bSector = data[i++];
    drive.bSectorEnd = data[i++];           // aka EOT
    drive.nBytes = data[i++];
    
    /*
     * The next group of properties are set by user requests to load/unload diskette images.
     * 
     * NOTE: I now avoid reinitializing drive.disk in order to retain any previously mounted diskette across resets.
     *
     *    drive.disk = null;                // when a "disk" is "inserted" into the "drive", this variable contains a Disk object
     */

    /*
     * The next group of properties are managed by worker functions (eg, doRead()) to maintain state across DMA requests.
     */
    drive.ibSector = data[i++];             // location of the next byte to be accessed in the current sector
    drive.sector = null;

    if (!drive.disk) {
        drive.sDiskettePath = "";           // ensure this is initialized to a default that displayDiskette() can deal with
    }

    var deltas = data[i++];
    if (deltas === Computer.VERSION_102) {
        var sDisketteName = data[i++];
        var sDiskettePath = data[i];
        /*
         * If loadDiskette() must actually mount a *different* disk image at this late stage (ie, if it returns false),
         * then we must mark ourselves as "not ready" again, and add another "wait for ready" test in Computer before
         * finally powering the CPU.  Otherwise, go ahead and restore any deltas to the current image.  
         */
        if (this.loadDiskette(iDrive, sDisketteName, sDiskettePath, true)) {
            if (drive.disk) {
                this.addDiskHistory(sDisketteName, sDiskettePath, drive.disk);
            }
        } else {
            this.setReady(false);
        }
    } else if (deltas !== undefined) {
        /*
         * If there's any data at all (ie, if this is a restore and not a reset), then it must be in the
         * pre-v1.02 save/restore format, so we'll restore as best we can, but be aware that if disk.restore()
         * notices that the currently mounted disk image differs from the disk image that these deltas belong to,
         * it will return false, and the restore operation will be aborted.
         */
        if (drive.disk && drive.disk.restore(deltas) < 0) {
            fSuccess = false;
        }
    }

    /*
     * TODO: If loadDiskette() returned true, then this can happen immediately.  Otherwise, loadDiskette()
     * will have merely "queued up" the load request and drive.disk won't be ready yet, so figure out how/when
     * we can properly restore drive.sector in that case.
     */
    if (fSuccess && drive.disk && drive.ibSector !== undefined) {
        drive.sector = drive.disk.seek(drive.bCylinder, drive.bHead, drive.bSector);
    }
    return fSuccess;
};

/**
 * saveDrives()
 *
 * @this {FDC}
 * @return {Array}
 */
FDC.prototype.saveDrives = function()
{
    var i = 0;
    var data = [];
    for (var iDrive = 0; iDrive < this.aDrives.length; iDrive++) {
        data[i++] = this.saveDrive(this.aDrives[iDrive]);
    }
    return data;
};

/**
 * saveDrive(drive)
 *
 * @this {FDC}
 * @return {Array}
 */
FDC.prototype.saveDrive = function(drive)
{
    var i = 0;
    var data = [];
    data[i++] = drive.errorCode;
    data[i++] = [drive.name, drive.nCylinders, drive.nHeads, drive.nSectors, drive.cbSector, drive.fRemovable];
    data[i++] = drive.bHead;
    data[i++] = -1;                     // where we used to store drive.nHeads (no longer used)
    data[i++] = drive.bCylinder;
    data[i++] = drive.bSector;
    data[i++] = drive.bSectorEnd;
    data[i++] = drive.nBytes;
    data[i++] = drive.ibSector;
    /*
     * Now we deviate from the 1.01a save format: instead of next storing all the deltas for the
     * currently mounted disk (if any), we store only the name and path of the currently mounted disk
     * (if any).  Deltas for ALL disks, both currently mounted and previously mounted, are stored later.
     * 
     *      data[i++] = drive.disk? drive.disk.save() : null;
     * 
     * To indicate this deviation, we store neither a null nor a delta array, but Computer.VERSION_102;
     * if that value is not present, then the restore code will know it's dealing with a pre-v1.02 state.
     */
    data[i++] = Computer.VERSION_102;
    data[i++] = drive.sDisketteName;
    data[i] = drive.sDiskettePath;
    return data;
};

/**
 * saveDeltas()
 *
 * This returns an array of entries, one for each disk image we've ever mounted, including any deltas; ie:
 *
 *      [name, path, deltas]
 *
 * aDiskHistory contains exactly that, except that deltas may not be up-to-date for any currently mounted
 * disk image(s), so we call updateHistory() for all those disks, and then aDiskHistory is ready to be saved.
 *
 * @this {FDC}
 * @return {Array}
 */
FDC.prototype.saveDeltas = function()
{
    for (var iDrive = 0; iDrive < this.aDrives.length; iDrive++) {
        var drive = this.aDrives[iDrive];
        if (drive.disk) {
            this.updateDiskHistory(drive.sDisketteName, drive.sDiskettePath, drive.disk);
        }
    }
    return this.aDiskHistory;
};

/**
 * copyDrive(iDrive)
 *
 * @this {FDC}
 * @param {number} iDrive
 * @return {Object|undefined} drive (which may be undefined if the requested drive does not exist)
 */
FDC.prototype.copyDrive = function(iDrive)
{
    var driveNew;
    var driveOld = this.aDrives[iDrive];
    if (driveOld !== undefined) {
        driveNew = {};
        for (var p in driveOld) {
            driveNew[p] = driveOld[p];
        }
    }
    return driveNew;
};

/**
 * seekDrive(drive, iSector, nSectors)
 *
 * The FDC doesn't need this function, since all FDC requests from the CPU are handled by doCmd().  This function
 * is used by other components (eg, Debugger) to mimic an FDC request, using a drive object obtained from copyDrive(),
 * to avoid disturbing the internal state of the FDC's drive objects.
 *
 * Also note that in an actual FDC request, drive.nBytes is initialized to the size of a single sector; the extent
 * of the entire transfer is actually determined by a count that has been pre-loaded into the DMA controller.  The FDC
 * isn't even aware of the extent of the transfer, so in the case of a read request, all readByte() can do is return bytes
 * until the current track (or, in the case of a multi-track request, the current cylinder) has been exhausted.
 *
 * Since seekDrive() is for use with non-DMA requests, we use nBytes to specify the length of the entire transfer.
 *
 * @this {FDC}
 * @param {Object} drive
 * @param {number} iSector (a "logical" sector number, relative to the entire disk, NOT a physical sector number)
 * @param {number} nSectors
 * @return {boolean} true if successful, false if invalid position request
 */
FDC.prototype.seekDrive = function(drive, iSector, nSectors)
{
    if (drive.disk) {
        var aDiskInfo = drive.disk.info();
        var nCylinders = aDiskInfo[0];
        var nHeads = aDiskInfo[1];
        var nSectorsPerTrack = aDiskInfo[2];
        var nSectorsPerCylinder = nHeads * nSectorsPerTrack;
        var nSectorsPerDisk = nCylinders * nSectorsPerCylinder;
        if (iSector + nSectors <= nSectorsPerDisk) {
            drive.bCylinder = Math.floor(iSector / nSectorsPerCylinder);
            iSector %= nSectorsPerCylinder;
            drive.bHead = Math.floor(iSector / nSectorsPerTrack);
            drive.bSector = (iSector % nSectorsPerTrack) + 1;
            drive.nBytes = nSectors * aDiskInfo[3];
            /*
             * NOTE: We don't set bSectorEnd, as an FDC command would, but it's irrelevant, because we don't actually
             * do anything with bSectorEnd at this point.  Perhaps someday, when we faithfully honor/restrict requests
             * to a single track (or a single cylinder, in the case of multi-track requests). 
             */
            drive.errorCode = FDC.REG_DATA.ERR.NONE;
            /*
             * At this point, we've finished simulating what an FDC.REG_DATA.CMD.READ_DATA command would have performed,
             * up through doRead().  Now it's the caller responsibility to call readByte(), just like the DMA Controller would.
             */
            return true;
        }
    }
    return false;
};

/**
 * autoMount(fRemount)
 *
 * @this {FDC}
 * @param {boolean} [fRemount] is true if we're remounting all auto-mounted diskettes
 * @return {boolean} true if one or more diskette images are being auto-mounted, false if none
 */
FDC.prototype.autoMount = function(fRemount)
{
    if (!fRemount) this.cAutoMount = 0;
    if (this.pAutoMount) {
        for (var sDrive in this.pAutoMount) {
            var pDriveConfig = this.pAutoMount[sDrive];
            if (pDriveConfig['name'] && pDriveConfig['path']) {
                /*
                 * WARNING: This conversion of drive letter to drive number, starting with A:, is very simplistic
                 * and is not guaranteed to match the drive mapping that DOS ultimately uses.
                 */
                var iDrive = sDrive.charCodeAt(0) - 0x41;
                if (iDrive >= 0 && iDrive < this.aDrives.length) {
                    if (!this.loadDiskette(iDrive, pDriveConfig['name'], pDriveConfig['path'], true) && fRemount)
                        this.setReady(false);
                    continue;
                }
            }
            this.notice("Unrecognized auto-mount specification for drive " + sDrive);
        }
    }
    return !!this.cAutoMount;
};

/**
 * loadDiskette(iDrive, sDisketteName, sDiskettePath, fAutoMount)
 *
 * NOTE: If sDiskettePath is already loaded in the drive, nothing needs to be done.
 *
 * @this {FDC}
 * @param {number} iDrive (pre-validated)
 * @param {string} sDisketteName
 * @param {string|null} sDiskettePath
 * @param {boolean} fAutoMount
 * @return {boolean} true if diskette (already) loaded, false if queued up (or busy)
 */
FDC.prototype.loadDiskette = function(iDrive, sDisketteName, sDiskettePath, fAutoMount)
{
    var drive = this.aDrives[iDrive];
    if (sDiskettePath && drive.sDiskettePath != sDiskettePath) {
        this.unloadDrive(iDrive, fAutoMount, true);
        if (drive.fBusy) {
            this.notice("Drive " + iDrive + " busy");
            return true;
        }
        drive.fBusy = true;
        if (fAutoMount) {
            drive.fAutoMount = true;
            this.cAutoMount++;
            this.messageDebugger("loading diskette '" + sDisketteName + "'");
        }
        var disk = new Disk(this, drive, DiskAPI.MODE.PRELOAD);
        disk.load(sDisketteName, sDiskettePath, this.mountDiskette);
        return false;
    }
    return true;
};

/**
 * mountDiskette(drive, disk, sDisketteName, sDiskettePath)
 *
 * @this {FDC}
 * @param {Object} drive
 * @param {Disk} disk is set if the disk was successfully mounted, null if not
 * @param {string} sDisketteName
 * @param {string} sDiskettePath
 */
FDC.prototype.mountDiskette = function(drive, disk, sDisketteName, sDiskettePath)
{
    drive.fBusy = false;
    if ((drive.disk = disk)) {
        drive.sDisketteName = sDisketteName;
        drive.sDiskettePath = sDiskettePath;
        this.addDiskHistory(sDisketteName, sDiskettePath, disk);
        
        /*
         * Clearly, a successful mount implies a disk change, and I suppose that, technically, an *unsuccessful*
         * mount should imply the same, but what would the real-world analog be?  Inserting a piece of cardboard
         * instead of an actual diskette?  In any case, if we can do the user a favor by pretending (as far as the
         * disk change line is concerned) that an unsuccessful mount never happened, let's do it.
         * 
         * Successful unmounts are a different story, however; those *do* trigger a change. See unloadDrive().
         */
        this.regInput |= FDC.REG_INPUT.DISK_CHANGE;
        
        /*
         * With the addition of notify(), users are now "alerted" whenever a diskette has finished loading;
         * notify() is selective about its output, using print() if a print window is open, alert() otherwise.
         *
         * WARNING: This conversion of drive number to drive letter, starting with A:, is very simplistic
         * and will not match the drive mappings that DOS ultimately uses (ie, for drives beyond B:).
         */
        this.notice("Mounted disk \"" + sDisketteName + "\" in drive " + String.fromCharCode(0x41 + drive.iDrive), drive.fAutoMount);
    }
    if (drive.fAutoMount) {
        drive.fAutoMount = false;
        if (!--this.cAutoMount) this.setReady();
    }
    this.displayDiskette(drive.iDrive);
};

/**
 * displayDiskette(iDrive, fUpdateDrive)
 *
 * @this {FDC}
 * @param {number} iDrive (unvalidated)
 * @param {boolean} [fUpdateDrive] is true to update the drive list to match the specified drive (eg, the auto-mount case)
 */
FDC.prototype.displayDiskette = function(iDrive, fUpdateDrive)
{
    /*
     * First things first: validate iDrive.
     */
    if (iDrive >= 0 && iDrive < this.aDrives.length) {
        var drive = this.aDrives[iDrive];
        var controlDisks = this.bindings["listDisks"];
        var controlDrives = this.bindings["listDrives"];
        /*
         * Next, make sure controls for both drives and disks exist.
         */
        if (controlDisks && controlDrives) {
            /*
             * Next, make sure the drive whose disk we're updating is the currently selected drive.
             */
            var i;
            var iDriveSelected = parseInt(controlDrives.value, 10);
            if (!isNaN(iDriveSelected) && iDriveSelected == iDrive) {
                for (i = 0; i < controlDisks.options.length; i++) {
                    if (controlDisks.options[i].value == drive.sDiskettePath) {
                        if (controlDisks.selectedIndex != i) {
                            controlDisks.selectedIndex = i;
                        }
                        break;
                    }
                }
                if (i == controlDisks.options.length) controlDisks.selectedIndex = 0;
            }
            if (fUpdateDrive) {
                for (i = 0; i < controlDrives.options.length; i++) {
                    if (parseInt(controlDrives.options[i].value, 10) == drive.iDrive) {
                        if (controlDrives.selectedIndex != i) {
                            controlDrives.selectedIndex = i;
                        }
                        break;
                    }
                }
            }
        }
    }
};

/**
 * unloadDrive(iDrive, fAutoUnload, fQuiet)
 *
 * @this {FDC}
 * @param {number} iDrive (pre-validated)
 * @param {boolean} [fAutoUnload] is true if this unload is being forced as part of an automount and/or restored mount
 * @param {boolean} [fQuiet]
 */
FDC.prototype.unloadDrive = function(iDrive, fAutoUnload, fQuiet)
{
    var drive = this.aDrives[iDrive];
    if (drive.disk) {
        /*
         * Before we toss the disk's information, capture any deltas that may have occurred.
         */
        this.updateDiskHistory(drive.sDisketteName, drive.sDiskettePath, drive.disk);
        drive.sDisketteName = "";
        drive.sDiskettePath = "";
        drive.disk = null;
        
        this.regInput |= FDC.REG_INPUT.DISK_CHANGE;
        
        /*
         * WARNING: This conversion of drive number to drive letter, starting with A:, is very simplistic
         * and is not guaranteed to match the drive mapping that DOS ultimately uses.
         */
        if (!fQuiet) {
            this.notice("Drive " + String.fromCharCode(0x41 + iDrive) + " unloaded", fAutoUnload);
        }
        /*
         * Try to avoid any unnecessary hysteresis regarding the diskette display if this unload is merely
         * a prelude to another load.
         */
        if (!fAutoUnload && !fQuiet) {
            this.displayDiskette(iDrive);
        }
    }
};

/**
 * unloadAllDrives(fDiscard)
 *
 * @this {FDC}
 * @param {boolean} fDiscard to discard all disk history before unloading
 */
FDC.prototype.unloadAllDrives = function(fDiscard)
{
    if (fDiscard) {
        this.aDiskHistory = [];
    }
    for (var iDrive = 0; iDrive < this.aDrives.length; iDrive++) {
        this.unloadDrive(iDrive, true);
    }
};

/**
 * addDiskHistory(sDisketteName, sDiskettePath, disk)
 *
 * @this {FDC}
 * @param {string} sDisketteName
 * @param {string} sDiskettePath
 * @param {Disk} disk containing corresponding disk image
 */
FDC.prototype.addDiskHistory = function(sDisketteName, sDiskettePath, disk)
{
    var i;
    for (i = 0; i < this.aDiskHistory.length; i++) {
        if (this.aDiskHistory[i][1] == sDiskettePath) {
            var nChanges = disk.restore(this.aDiskHistory[i][2]);
            if (DEBUG) this.messageDebugger("disk '" + sDisketteName + "' restored from history (" + nChanges + " changes)");
            return;
        }
    }
    if (DEBUG) this.messageDebugger("disk '" + sDisketteName + "' added to history (" + sDiskettePath + ")");
    this.aDiskHistory[i] = [sDisketteName, sDiskettePath, []];
};

/**
 * removeDiskHistory(sDisketteName, sDiskettePath)
 *
 * @this {FDC}
 * @param {string} sDisketteName
 * @param {string} sDiskettePath
 */
FDC.prototype.removeDiskHistory = function(sDisketteName, sDiskettePath)
{
    var i;
    for (i = 0; i < this.aDiskHistory.length; i++) {
        if (this.aDiskHistory[i][1] == sDiskettePath) {
            this.aDiskHistory.splice(i, 1);
            if (DEBUG) this.messageDebugger("disk '" + sDisketteName + "' removed from history");
            return;
        }
    }
    if (DEBUG) this.messageDebugger("unable to remove disk '" + sDisketteName + "' from history (" + sDiskettePath + ")");
};

/**
 * updateDiskHistory(sDisketteName, sDiskettePath, disk)
 *
 * @this {FDC}
 * @param {string} sDisketteName
 * @param {string} sDiskettePath
 * @param {Disk} disk containing corresponding disk image, with possible deltas
 */
FDC.prototype.updateDiskHistory = function(sDisketteName, sDiskettePath, disk)
{
    var i;
    for (i = 0; i < this.aDiskHistory.length; i++) {
        if (this.aDiskHistory[i][1] == sDiskettePath) {
            this.aDiskHistory[i][2] = disk.save();
            if (DEBUG) this.messageDebugger("disk '" + sDisketteName + "' updated in history");
            return;
        }
    }
    /*
     * I used to report this as an error (at least in the DEBUG release), but it's no longer really
     * an error, because if we're trying to re-mount a clean copy of a disk, we toss its history, then
     * unload, and then reload/remount.  And since unloadDrive's normal behavior is to call updateDiskHistory()
     * before unloading, the fact that the disk is no longer listed here can't be treated as an error.
     */
    if (DEBUG) this.messageDebugger("unable to update disk '" + sDisketteName + "' in history (" + sDiskettePath + ")");
};

/**
 * outFDCOutput(port, bOut, addrFrom)
 *
 * @this {FDC}
 * @param {number} port (0x3F2, output only)
 * @param {number} bOut
 * @param {number|undefined} addrFrom (not defined whenever the Debugger tries to read the specified port)
 */
FDC.prototype.outFDCOutput = function(port, bOut, addrFrom)
{
    this.messagePort(port, bOut, addrFrom, "OUTPUT");
    if (!(bOut & FDC.REG_OUTPUT.ENABLE)) {
        this.initController();
    } else if (!(this.regOutput & FDC.REG_OUTPUT.ENABLE)) {
        /*
         * When FDC.REG_OUTPUT.ENABLE transitions from 0 to 1, generate an interrupt
         */
        if (this.regOutput & FDC.REG_OUTPUT.INT_ENABLE) {
            if (this.chipset) this.chipset.setIRR(ChipSet.IRQ.FDC);
        }
    }
    var iDrive = bOut & FDC.REG_OUTPUT.SELECT;
    if (bOut & (FDC.REG_OUTPUT.MOTOR_A << iDrive))
        this.iDrive = iDrive;
    this.regOutput = bOut;
};

/**
 * inFDCStatus(port, addrFrom)
 *
 * @this {FDC}
 * @param {number} port (0x3F4, input only)
 * @param {number|undefined} addrFrom (not defined whenever the Debugger tries to read the specified port)
 * @return {number} simulated port value
 */
FDC.prototype.inFDCStatus = function(port, addrFrom)
{
    this.messagePort(port, null, addrFrom, "STATUS", this.regStatus);
    return this.regStatus;
};

/**
 * inFDCData(port, addrFrom)
 *
 * @this {FDC}
 * @param {number} port (0x3F5, input/output)
 * @param {number|undefined} addrFrom (not defined whenever the Debugger tries to read the specified port)
 * @return {number} simulated port value
 */
FDC.prototype.inFDCData = function(port, addrFrom)
{
    var bIn = 0;
    if (this.regDataIndex < this.regDataTotal) {
        bIn = this.regDataArray[this.regDataIndex];
    }
    /*
     * As per the discussion in doCmd(), once the first byte of the Result Phase has been read, the interrupt must be cleared.
     */
    if (this.regOutput & FDC.REG_OUTPUT.INT_ENABLE) {
        if (this.chipset) this.chipset.clearIRR(ChipSet.IRQ.FDC);
    }
    this.messagePort(port, null, addrFrom, "DATA[" + this.regDataIndex + "]", bIn);
    if (++this.regDataIndex >= this.regDataTotal) {
        this.regStatus &= ~(FDC.REG_STATUS.READ_DATA | FDC.REG_STATUS.BUSY);
        this.regDataIndex = this.regDataTotal = 0;
    }
    return bIn;
};

/**
 * outFDCData(port, bOut, addrFrom)
 *
 * @this {FDC}
 * @param {number} port (0x3F5, input/output)
 * @param {number} bOut
 * @param {number|undefined} addrFrom (not defined whenever the Debugger tries to read the specified port)
 */
FDC.prototype.outFDCData = function(port, bOut, addrFrom)
{
    this.messagePort(port, bOut, addrFrom, "DATA[" + this.regDataTotal + "]");
    
    if (this.regDataTotal < this.regDataArray.length) {
        this.regDataArray[this.regDataTotal++] = bOut;
    }
    var bCmd = this.regDataArray[0];
    var bCmdMasked = bCmd & FDC.REG_DATA.CMD.MASK;
    if (FDC.aCmdSeqs[bCmdMasked] !== undefined) {
        if (this.regDataTotal >= FDC.aCmdSeqs[bCmdMasked].cbWrite) {
            this.doCmd();
        }
        return;
    }
    if (DEBUG) this.messageDebugger("unsupported FDC command: " + str.toHexByte(bCmd));
};

/**
 * inFDCInput(port, addrFrom)
 *
 * @this {FDC}
 * @param {number} port (0x3F7, input only, MODEL_5170 only)
 * @param {number|undefined} addrFrom (not defined whenever the Debugger tries to read the specified port)
 * @return {number} simulated port value
 */
FDC.prototype.inFDCInput = function(port, addrFrom)
{
    var bIn = this.regInput;
    /*
     * TODO: Determine when the DISK_CHANGE bit is *really* cleared (this is just a guess)
     */
    this.regInput &= ~FDC.REG_INPUT.DISK_CHANGE;
    this.messagePort(port, null, addrFrom, "INPUT", bIn);
    return bIn;
};

/**
 * outFDCControl(port, bOut, addrFrom)
 *
 * @this {FDC}
 * @param {number} port (0x3F7, output only, MODEL_5170 only)
 * @param {number} bOut
 * @param {number|undefined} addrFrom (not defined whenever the Debugger tries to read the specified port)
 */
FDC.prototype.outFDCControl = function(port, bOut, addrFrom)
{
    this.messagePort(port, bOut, addrFrom, "CONTROL");
    this.regControl  = bOut;
};

/**
 * intBIOSDiskette(addr)
 *
 * NOTE: This function tries to differentiate FDC requests from HDC requests, by whether the INT 0x13 drive number in DL is < 0x80;
 * however, not all INT 0x13 functions required a drive number in DL, and not all callers supplied one.
 *
 * INT 0x13 Quick Reference:
 *
 *      AH: 0x00    Reset
 *          0x01    Get status (from last operation)
 *          0x02    Read sectors
 *          0x03    Write sectors
 *          0x04    Verify sectors
 *          0x05    Format track
 *
 * For Read, Write, Verify and Format commands:
 *
 *      DL: drive number (0-3 allowed, value checked)
 *      DH: head number (0-1 allowed, not value checked)
 *      CH: track number (0-39 allowed, not value checked [which is good, because high-density diskettes go up to 80 tracks])
 *      CL: sector number (1-8 allowed, not value checked [which is good, because support for 9-sector tracks was later added])
 *      AL: number of sectors (max of 8, not value checked)
 *      ES:BX: sector buffer
 *
 * @this {FDC}
 * @param {number} addr
 * @return {boolean} true to proceed with the INT 0x13 software interrupt, false to skip
 */
FDC.prototype.intBIOSDiskette = function(addr)
{
    if (DEBUGGER) {
        var DL = this.cpu.regDX & 0xff;
        if (this.dbg && this.dbg.messageEnabled(this.dbg.MESSAGE_FDC) && DL < 0x80) {
            this.dbg.message("FDC.intBIOS(AX=" + str.toHexWord(this.cpu.regAX) + ",DL=" + str.toHexByte(DL) + ") at " + str.toHexAddr(addr - this.cpu.segCS.base, this.cpu.segCS.sel));
            // this.cpu.haltCPU();
            this.cpu.addInterruptReturn(addr, function (fdc, nCycles) {
                return function onBIOSDisketteReturn(nLevel) {
                    fdc.intBIOSDisketteReturn(nCycles, nLevel);
                };
            }(this, this.cpu.getCycles()));
        }
    }
    return true;
};

/**
 * intBIOSDisketteReturn(nCycles, nLevel)
 *
 * @this {FDC}
 * @param {number} nCycles
 * @param {number} nLevel
 */
FDC.prototype.intBIOSDisketteReturn = function(nCycles, nLevel)
{
    if (DEBUGGER) {
        nCycles = this.cpu.getCycles() - nCycles;
        this.messageDebugger("FDC.intBIOSReturn(" + nLevel + "): C=" + (this.cpu.getCF() ? 1 : 0) + " (cycles=" + nCycles + ")");
        // if (DEBUG && nCycles > 10000) this.cpu.haltCPU();
    }
};

/**
 * doCmd()
 *
 * @this {FDC}
 */
FDC.prototype.doCmd = function()
{
    var fIRQ = false;
    this.regDataIndex = 0;
    var bCmd = this.popCmd();
    var iUnitSelect, drive, bHeadSelect, bHead, n;

    /*
     * NOTE: We currently ignore the FDC.REG_DATA.CMD.SK, FDC.REG_DATA.CMD.MF and FDC.REG_DATA.CMD.MT bits of every command.
     * The only command bit of possible interest down the road might be the FDC.REG_DATA.CMD.MT (Multi-Track); the rest relate
     * to storage format details that we cannot emulate as long as our diskette images contain nothing more than sector
     * data without any formatting data.
     * 
     * Similarly, we ignore parameters like SRT, HUT, HLT and the like, since our "motors" don't require physical delays; 
     * however, if timing issues become compatibility issues, we might have to start honoring those delays.  In any case,
     * the maximum speed of the simulation will still be limited by various spin-loops in the ROM BIOS that wait prescribed
     * times, so even with infinitely fast hardware, the simulation will never run as fast as it theoretically could,
     * unless we opt to identify those spin-loops and either patch them or skip over them.
     */
    var bCmdMasked = bCmd & FDC.REG_DATA.CMD.MASK;
    switch (bCmdMasked) {
        case FDC.REG_DATA.CMD.SPECIFY:              // 0x03
            this.popSRT();                          // SRT and HUT (encodings?)
            this.popHLT();                          // HLT and ND (encodings?)
            this.beginResult();                     // no results are provided by this command, and fIRQ should remain false
            break;
        case FDC.REG_DATA.CMD.DRIVE_STATUS:         // 0x04
            iUnitSelect = this.popCmd("US");
            bHeadSelect = (iUnitSelect >> 2) & 0x1;
            this.iUnit = (iUnitSelect &= 0x3);
            drive = this.aDrives[iUnitSelect];
            this.beginResult();
            this.pushST3(drive);
            break;
        case FDC.REG_DATA.CMD.WRITE_DATA:           // 0x05
        case FDC.REG_DATA.CMD.READ_DATA:            // 0x06
            iUnitSelect = this.popCmd("US");
            bHeadSelect = (iUnitSelect >> 2) & 0x1;
            iUnitSelect &= 0x3;
            this.iUnit = iUnitSelect;
            drive = this.aDrives[iUnitSelect];
            drive.bHead = bHeadSelect;
            drive.bCylinder = this.popCmd("C");     // C
            bHead = this.popCmd("H");               // H
            Component.assert(bHead == bHeadSelect);
            drive.bSector = this.popCmd("R");       // R
            n = this.popCmd("N");                   // N
            drive.nBytes = 128 << n;                // 0 => 128, 1 => 256, 2 => 512, 3 => 1024
            drive.bSectorEnd = this.popCmd("EOT");  // EOT (final sector number on a cylinder)
            this.popCmd("GPL");                     // GPL (spacing between sectors, excluding VCO Sync Field; 3)
            this.popCmd("DTL");                     // DTL (when N is 0, DTL stands for the data length to read out or write into the sector)
            if (bCmdMasked == FDC.REG_DATA.CMD.READ_DATA)
                this.doRead(drive);
            else
                this.doWrite(drive);
            this.beginResult();
            this.pushST0(drive.errorCode);
            this.pushST1(drive.errorCode);
            this.pushST2(drive.errorCode);
            this.pushResult(drive.bCylinder, "C");
            this.pushResult(drive.bHead, "H");
            this.pushResult(drive.bSector, "R");
            this.pushResult(n, "N");
            fIRQ = true;
            break;
        case FDC.REG_DATA.CMD.RECALIBRATE:          // 0x07
            this.iUnit = iUnitSelect = this.popCmd("US") & 0x3;
            drive = this.aDrives[iUnitSelect];
            drive.bCylinder = 0;
            drive.errorCode = FDC.REG_DATA.ERR.SEEK_END;
            this.beginResult();                     // no results are provided; this command is typically followed by FDC.REG_DATA.CMD.INT_STATUS
            fIRQ = true;
            break;
        case FDC.REG_DATA.CMD.INT_STATUS:           // 0x08
            this.iUnit = this.iDrive;
            drive = this.aDrives[this.iUnit];
            this.beginResult();
            this.pushST0(drive.errorCode);
            this.pushResult(drive.bCylinder, "PCN");// no interrupt is generated by this command, so fIRQ should remain false
            break;
        case FDC.REG_DATA.CMD.FORMAT_TRACK:         // 0x0D
            iUnitSelect = this.popCmd("US");
            bHeadSelect = (iUnitSelect >> 2) & 0x1;
            iUnitSelect &= 0x3;
            this.iUnit = iUnitSelect;
            drive = this.aDrives[iUnitSelect];
            drive.bHead = bHeadSelect;
            n = this.popCmd("N");                   // N
            drive.nBytes = 128 << n;                // 0 => 128, 1 => 256, 2 => 512, 3 => 1024 (bytes/sector)
            drive.bSectorEnd = this.popCmd("SC");   // SC (sectors/track)
            this.popCmd("GPL");                     // GPL (spacing between sectors, excluding VCO Sync Field; 3)
            drive.bFiller = this.popCmd("D");       // D (filler byte)
            this.doFormat(drive);
            this.beginResult();
            this.pushST0(drive.errorCode);
            this.pushST1(drive.errorCode);
            this.pushST2(drive.errorCode);
            this.pushResult(drive.bCylinder, "C");
            this.pushResult(drive.bHead, "H");
            this.pushResult(drive.bSector, "R");
            this.pushResult(n, "N");
            fIRQ = true;
            break;
        case FDC.REG_DATA.CMD.SEEK:                 // 0x0F
            iUnitSelect = this.popCmd("US");
            bHeadSelect = (iUnitSelect >> 2) & 0x1;
            this.iUnit = (iUnitSelect &= 0x3);
            drive = this.aDrives[iUnitSelect];
            drive.bHead = bHeadSelect;
            drive.bCylinder = this.popCmd("NCN");
            drive.errorCode = FDC.REG_DATA.ERR.SEEK_END;
            this.beginResult();                     // like FDC.REG_DATA.CMD.RECALIBRATE, no results are provided 
            fIRQ = true;
            break;
        default:
            if (DEBUG) this.messageDebugger("FDC operation unsupported (command=0x: " + str.toHexByte(bCmd) + ")");
            break;
    }

    if (this.regDataTotal > 0) this.regStatus |= (FDC.REG_STATUS.READ_DATA | FDC.REG_STATUS.BUSY);

    /*
     * After the Execution Phase (eg, DMA Terminal Count has occurred, or the EOT sector has been read/written),
     * an interrupt is supposed to occur, signaling the beginning of the Result Phase.  Once the first byte of the
     * result has been read, the interrupt is cleared (see inFDCData).
     * 
     * TODO: Technically, interrupt request status should be cleared by the FDC.REG_DATA.CMD.INT_STATUS command; in fact,
     * if that command is issued and no interrupt was pending, then FDC.REG_DATA.ERR.INVALID should be returned (via ST0).
     */
    if (this.regOutput & FDC.REG_OUTPUT.INT_ENABLE) {
        if (drive && !(drive.errorCode & FDC.REG_DATA.ERR.NOT_READY) && fIRQ) {
            if (this.chipset) this.chipset.setIRR(ChipSet.IRQ.FDC);
        }
    }
};

/**
 * popCmd(name)
 *
 * @this {FDC}
 * @param {string|undefined} [name]
 * @return {number}
 */
FDC.prototype.popCmd = function(name)
{
    Component.assert((!this.regDataIndex || name !== undefined) && this.regDataIndex < this.regDataTotal);
    var bCmd = this.regDataArray[this.regDataIndex];
    if (DEBUG && DEBUGGER && this.dbg && this.dbg.messageEnabled((this.regDataIndex > 0 ? this.dbg.MESSAGE_PORT : 0) | this.dbg.MESSAGE_FDC)) {
        var bCmdMasked = bCmd & FDC.REG_DATA.CMD.MASK;
        if (!name && !this.regDataIndex && FDC.aCmdSeqs[bCmdMasked]) name = FDC.aCmdSeqs[bCmdMasked].name;
        this.dbg.message("FDC.CMD[" + (name !== undefined ? name : this.regDataIndex) + "]: 0x" + str.toHexByte(bCmd));
    }
    this.regDataIndex++;
    return bCmd;
};

/**
 * popHLT()
 *
 * NOTE: This byte is actually a combination of HLT (Head Load Time) and ND (Non-DMA Mode)
 *
 * @this {FDC}
 */
FDC.prototype.popHLT = function()
{
    this.popCmd("HLT");
 // this.nHLT = this.popCmd("HLT");
};

/**
 * popSRT()
 *
 * NOTE: This byte is actually a combination of SRT (Step Rate Time) and HUT (Head Unload Time)
 *
 * @this {FDC}
 */
FDC.prototype.popSRT = function()
{
    this.popCmd("SRT");
 // this.nSRT = this.popCmd("SRT");
};

/**
 * beginResult()
 *
 * @this {FDC}
 */
FDC.prototype.beginResult = function()
{
    this.regDataIndex = this.regDataTotal = 0;
};

/**
 * pushResult(bResult, name)
 *
 * @this {FDC}
 * @param {number} bResult
 * @param {string|undefined} [name]
 */
FDC.prototype.pushResult = function(bResult, name)
{
    if (DEBUG && DEBUGGER && this.dbg && this.dbg.messageEnabled(this.dbg.MESSAGE_PORT | this.dbg.MESSAGE_FDC)) this.dbg.message("FDC.RES[" + (name !== undefined ? name : this.regDataTotal) + "]: 0x" + str.toHexByte(bResult));
    this.regDataArray[this.regDataTotal++] = bResult;
};

/**
 * pushST0(errorCode)
 *
 * @this {FDC}
 * @param {number} errorCode
 */
FDC.prototype.pushST0 = function(errorCode)
{
    this.pushResult(this.iUnit | this.aDrives[this.iUnit].bHead | (errorCode & FDC.REG_DATA.ERR.ST0), "ST0");
};

/**
 * pushST1(errorCode)
 *
 * @this {FDC}
 * @param {number} errorCode
 */
FDC.prototype.pushST1 = function(errorCode)
{
    this.pushResult((errorCode & FDC.REG_DATA.ERR.ST1) >> 8, "ST1");
};

/**
 * pushST2(errorCode)
 *
 * @this {FDC}
 * @param {number} errorCode
 */
FDC.prototype.pushST2 = function(errorCode)
{
    this.pushResult((errorCode & FDC.REG_DATA.ERR.ST2) >> 16, "ST2");
};

/**
 * pushST3(drive)
 *
 * @this {FDC}
 * @param {Object} drive
 */
FDC.prototype.pushST3 = function(drive)
{
    //
    // WARNING: Unimplemented
    //
    this.pushResult(0x00, "ST3");
};

/**
 * dmaRead(drive, b, done)
 *
 * @this {FDC}
 * @param {Object} drive
 * @param {number} b
 * @param {function(number,boolean)} done
 */
FDC.prototype.dmaRead = function(drive, b, done)
{
    if (b === undefined || b < 0) {
        this.readByte(drive, done);
        return;
    }
    /*
     * The DMA controller should be ASKING for data, not GIVING us data; this suggests an internal DMA miscommunication
     */
    if (DEBUG) this.messageDebugger("dmaRead(): invalid DMA acknowledgement");
    done(-1, false);
};

/**
 * dmaWrite(drive, b)
 *
 * @this {FDC}
 * @param {Object} drive
 * @param {number} b
 * @return {number}
 */
FDC.prototype.dmaWrite = function(drive, b)
{
    if (b !== undefined && b >= 0)
        return this.writeByte(drive, b);
    /*
     * The DMA controller should be GIVING us data, not ASKING for data; this suggests an internal DMA miscommunication
     */
    if (DEBUG) this.messageDebugger("dmaWrite(): invalid DMA acknowledgement");
    return -1;
};

/**
 * dmaFormat(drive, b)
 *
 * @this {FDC}
 * @param {Object} drive
 * @param {number} b
 * @returns {number}
 */
FDC.prototype.dmaFormat = function(drive, b)
{
    if (b !== undefined && b >= 0)
        return this.writeFormat(drive, b);
    /*
     * The DMA controller should be GIVING us data, not ASKING for data; this suggests an internal DMA miscommunication
     */
    if (DEBUG) this.messageDebugger("dmaFormat(): invalid DMA acknowledgement");
    return -1;
};

/**
 * doRead(drive)
 *
 * @this {FDC}
 * @param {Object} drive
 */
FDC.prototype.doRead = function(drive)
{
    /*
     * With only NOT_READY and INCOMPLETE set, an empty drive causes DOS to report "General Failure";
     * with the addition of NO_DATA, DOS reports "Sector not found".
     */
    drive.errorCode = FDC.REG_DATA.ERR.NOT_READY | FDC.REG_DATA.ERR.INCOMPLETE;

    if (DEBUG) this.messageDebugger("FDC.doRead(" + drive.bCylinder + ":" + drive.bHead + ":" + drive.bSector + ":" + drive.nBytes + ")");

    if (drive.disk) {
        drive.sector = null;
        drive.errorCode = FDC.REG_DATA.ERR.NONE;
        if (this.chipset) {
            this.chipset.connectDMA(ChipSet.DMA_FDC, this, 'dmaRead', drive);
            this.chipset.requestDMA(ChipSet.DMA_FDC);
        }
    }
};

/**
 * doWrite(drive)
 *
 * @this {FDC}
 * @param {Object} drive
 */
FDC.prototype.doWrite = function(drive)
{
    drive.errorCode = FDC.REG_DATA.ERR.NOT_READY | FDC.REG_DATA.ERR.INCOMPLETE;

    if (DEBUG) this.messageDebugger("FDC.doWrite(" + drive.bCylinder + ":" + drive.bHead + ":" + drive.bSector + ":" + drive.nBytes + ")");

    if (drive.disk) {
        if (drive.disk.fWriteProtected) {
            drive.errorCode = FDC.REG_DATA.ERR.NOT_WRITABLE | FDC.REG_DATA.ERR.INCOMPLETE;
            return;
        }
        drive.sector = null;
        drive.errorCode = FDC.REG_DATA.ERR.NONE;
        if (this.chipset) {
            this.chipset.connectDMA(ChipSet.DMA_FDC, this, 'dmaWrite', drive);
            this.chipset.requestDMA(ChipSet.DMA_FDC);
        }
    }
};

/**
 * doFormat(drive)
 *
 * drive is initialized by doCmd() to the following extent:
 *
 *      drive.bHead (ignored)
 *      drive.nBytes (bytes/sector)
 *      drive.bSectorEnd (sectors/track)
 *      drive.bFiller (fill byte)
 *
 * and we expect the DMA controller to provide C, H, R and N (ie, 4 bytes) for each sector to be formatted.
 *
 * @this {FDC}
 * @param {Object} drive
 */
FDC.prototype.doFormat = function(drive)
{
    drive.errorCode = FDC.REG_DATA.ERR.NOT_READY | FDC.REG_DATA.ERR.INCOMPLETE;
    
    //if (DEBUG) this.messageDebugger("doFormat()");
    
    if (drive.disk) {
        drive.sector = null;
        drive.errorCode = FDC.REG_DATA.ERR.NONE;
        if (this.chipset) {
            drive.cbFormat = 0;
            drive.abFormat = new Array(4);
            drive.bFormatting = true;
            drive.cSectorsFormatted = 0;
            this.chipset.connectDMA(ChipSet.DMA_FDC, this, 'dmaFormat', drive);
            this.chipset.requestDMA(ChipSet.DMA_FDC);
            drive.bFormatting = false;
        }
    }
};

/**
 * readByte(drive)
 *
 * The following drive properties must have been setup prior to our first call:
 *
 *      drive.bHead
 *      drive.bCylinder
 *      drive.bSector
 *      drive.sector (initialized to null)
 *
 * On the first readByte() request, since drive.sector will be null, we ask the Disk object to look
 * up the first sector of the request.  We then ask the Disk for bytes from that sector until the sector
 * is exhausted, and then we look up the next sector and continue the process.
 *
 * NOTE: Since the FDC isn't aware of the extent of the transfer, all readByte() can do is return bytes
 * until the current track (or, in the case of a multi-track request, the current cylinder) has been exhausted.
 *
 * TODO: Research the requirements, if any, for multi-track I/O and determine what if anything needs to be
 * done.  At the very least, if it must be supported, there would need to be some head-incrementing somewhere.
 *
 * @this {FDC}
 * @param {Object} drive
 * @param {function(number,boolean)} done (number is next available byte from drive, or -1 if no more bytes available)
 */
FDC.prototype.readByte = function(drive, done)
{
    var b = -1;
    if (!drive.errorCode && drive.disk) {
        do {
            if (drive.sector) {
                if ((b = drive.disk.read(drive.sector, drive.ibSector++)) >= 0)
                    break;
            }
            /*
             * Locate the next sector, and then try reading again.
             */
            drive.sector = drive.disk.seek(drive.bCylinder, drive.bHead, drive.bSector);
            if (!drive.sector) {
                drive.errorCode = FDC.REG_DATA.ERR.NO_DATA | FDC.REG_DATA.ERR.INCOMPLETE;
                break;
            }
            drive.ibSector = 0;
            drive.bSector++;
        } while (true);
    }
    done(b, false);
};

/**
 * writeByte(drive, b)
 *
 * The following drive properties must have been setup prior to our first call:
 *
 *      drive.bHead
 *      drive.bCylinder
 *      drive.bSector
 *      drive.sector (initialized to null)
 *
 * On the first writeByte() request, since drive.sector will be null, we ask the Disk object to look
 * up the first sector of the request.  We then send the Disk bytes for that sector until the sector
 * is full, and then we look up the next sector and continue the process.
 *
 * NOTE: Since the FDC isn't aware of the extent of the transfer, all writeByte() can do is accept bytes
 * until the current track (or, in the case of a multi-track request, the current cylinder) has been exhausted.
 *
 * TODO: Research the requirements, if any, for multi-track I/O and determine what if anything needs to be
 * done.  At the very least, if it must be supported, there would need to be some head-incrementing somewhere.
 *
 * @this {FDC}
 * @param {Object} drive
 * @param {number} b containing next byte to write
 * @return {number} (b unchanged; return -1 if command should be terminated)
 */
FDC.prototype.writeByte = function(drive, b)
{
    if (drive.errorCode || !drive.disk) return -1;
    do {
        if (drive.sector) {
            if (drive.disk.write(drive.sector, drive.ibSector++, b))
                break;
        }
        /*
         * Locate the next sector, and then try writing again.
         */
        drive.sector = drive.disk.seek(drive.bCylinder, drive.bHead, drive.bSector);
        if (!drive.sector) {
            /*
             * TODO: Determine whether this should be FDC.REG_DATA.ERR.CRC_ERROR or FDC.REG_DATA.ERR.DATA_FIELD
             */
            drive.errorCode = FDC.REG_DATA.ERR.CRC_ERROR | FDC.REG_DATA.ERR.INCOMPLETE;
            b = -1;
            break;
        }
        drive.ibSector = 0;
        drive.bSector++;
    } while (true);
    return b;
};

/**
 * writeFormat(drive, b)
 *
 * @this {FDC}
 * @param {Object} drive
 * @param {number} b containing a format command byte
 * @return {number} (b if successful, -1 if command should be terminated)
 */
FDC.prototype.writeFormat = function(drive, b)
{
    if (drive.errorCode) return -1;
    drive.abFormat[drive.cbFormat++] = b;
    if (drive.cbFormat == drive.abFormat.length) {
        drive.bCylinder = drive.abFormat[0];    // C
        drive.bHead = drive.abFormat[1];        // H
        drive.bSector = drive.abFormat[2];      // R
        drive.nBytes = 128 << drive.abFormat[3];// N (0 => 128, 1 => 256, 2 => 512, 3 => 1024)
        drive.cbFormat = 0;
        if (DEBUG) this.messageDebugger("writeFormat(head=" + str.toHexByte(drive.bHead) + ",cyl=" + str.toHexByte(drive.bCylinder) + ",sec=" + str.toHexByte(drive.bSector) + ",len=" + str.toHexWord(drive.nBytes) + ")");
        for (var i = 0; i < drive.nBytes; i++) {
            if (this.writeByte(drive, drive.bFiller) < 0) {
                return -1;
            }
        }
        drive.cSectorsFormatted++; 
    }
    if (drive.cSectorsFormatted >= drive.bSectorEnd) b = -1;
    return b;
};

/**
 * messageDebugger(sMessage)
 *
 * This is a combination of the Debugger's messageEnabled(MESSAGE_FDC) and message() functions, for convenience.
 *
 * @this {FDC}
 * @param {string} sMessage is any caller-defined message string
 */
FDC.prototype.messageDebugger = function(sMessage)
{
    if (DEBUGGER && this.dbg) {
        if (this.dbg.messageEnabled(this.dbg.MESSAGE_FDC)) {
            this.dbg.message(sMessage);
        }
    }
};

/**
 * messagePort(port, bOut, addrFrom, name, bIn)
 *
 * This is an internal version of the Debugger's messagePort() function, for convenience.
 *
 * @this {FDC}
 * @param {number} port
 * @param {number|null} bOut if an output operation
 * @param {number|null} [addrFrom]
 * @param {string|null} [name] of the port, if any
 * @param {number} [bIn] is the input value, if known, on an input operation
 */
FDC.prototype.messagePort = function(port, bOut, addrFrom, name, bIn)
{
    if (DEBUGGER && this.dbg) {
        this.dbg.messagePort(this, port, bOut, addrFrom, name, this.dbg.MESSAGE_FDC, bIn);
    }
};

/*
 * Port input notification table
 * 
 * TODO: Even though port 0x3F7 was not present on controllers prior to MODEL_5170, I'm taking the easy
 * way out and always emulating it.  So, consider an FDC parameter to disable that feature for stricter compatibility.
 */
FDC.aPortInput = {
    0x3F4: FDC.prototype.inFDCStatus,
    0x3F5: FDC.prototype.inFDCData,
    0x3F7: FDC.prototype.inFDCInput
};

/*
 * Port output notification table
 * 
 * TODO: Even though port 0x3F7 was not present on controllers prior to MODEL_5170, I'm taking the easy
 * way out and always emulating it.  So, consider an FDC parameter to disable that feature for stricter compatibility.
 */
FDC.aPortOutput = {
    0x3F2: FDC.prototype.outFDCOutput,
    0x3F5: FDC.prototype.outFDCData,
    0x3F7: FDC.prototype.outFDCControl
};

/**
 * FDC.init()
 *
 * This function operates on every element (e) of class "fdc", and initializes
 * all the necessary HTML to construct the FDC module(s) as spec'ed.
 *
 * Note that each element (e) of class "fdc" is expected to have a "data-value"
 * attribute containing the same JSON-encoded parameters that the FDC constructor expects.
 */
FDC.init = function() {
    var aeFDC = Component.getElementsByClass(window.document, PCJSCLASS, "fdc");
    for (var iFDC = 0; iFDC < aeFDC.length; iFDC++) {
        var eFDC = aeFDC[iFDC];
        var parmsFDC = Component.getComponentParms(eFDC);
        var fdc = new FDC(parmsFDC);
        Component.bindComponentControls(fdc, eFDC, PCJSCLASS);
    }
};

/*
 * Initialize every Floppy Drive Controller (FDC) module on the page.
 */
web.onInit(FDC.init);

if (typeof APP_PCJS !== 'undefined') APP_PCJS.FDC = FDC;

if (typeof module !== 'undefined') module.exports = FDC;