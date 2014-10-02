About JavaScript Machines
---

The JavaScript Machines (**JSMachines**) project is a collection of computer simulations written in JavaScript,
maintained on [GitHub](http://github.com/), and hosted at [pcjs.org](http://www.pcjs.org/) (formerly
[jsmachines.net](http://jsmachines.net/)).

The goals of the project are to create fast, full-featured simulations of classic computer
hardware, help people understand how these early machines worked, make it easy to experiment with different machine
configurations, and provide a platform for running and analyzing old computer software.

The simulations are written entirely in JavaScript and run well in a variety of web browsers, on both
desktop and mobile devices.  Machines are created with simple XML files that define a set of machine components,
along with the features that each component should enable.  More details about machine definitions and component
capabilities can be found in the [Documentation](/docs/).

---

### Emulating the Challenger 1P

The first **JSMachines** application was [C1Pjs](/docs/c1pjs/), a simulation of the
Challenger 1P, which was a 6502-based microcomputer introduced by Ohio Scientific in 1978.

C1Pjs v1.0 was released in July 2012, first on ecpsim.org and cpusim.org, then on [jsmachines.net](http://jsmachines.net/c1pjs),
and finally [pcjs.org](http://www.pcjs.org/). More information about the first release of C1Pjs was also 
[posted](http://osiweb.org/osiforum/viewtopic.php?f=3&t=103) on the [OSI Discussion Forum](http://osiweb.org/osiforum/index.php)
at [osiweb.org](http://osiweb.org/).

---

### Emulating the IBM PC

The next **JSMachines** application was [PCjs](/docs/about/pcjs/), which simulates the original IBM PC and IBM PC XT.

[PCjs](/docs/about/pcjs/) emulates the Intel 8088 CPU, as well as IBM Monochrome Display Adapter (MDA) and
Color Display Adapter (CGA) video cards, along with assorted motherboard and expansion bus components.  It also
includes an optional debugger and a user-configurable control panel.

PCjs v1.0 was released on [jsmachines.net](http://jsmachines.net/) in late 2012, and the **JSMachines** project,
with its second full-featured machine emulation, was launched.

See the PCjs [History](/docs/about/pcjs/) for information about more recent releases.

---

### Migrating to Node.js

The **JSMachines** project was migrated to a [Node.js](http://nodejs.org) web server ([pcjs.org](http://www.pcjs.org/))
in 2014.

The goals included:

- Using JavaScript exclusively, for both client and server development
- Leveraging the Node.js web server to provide more sophisticated I/O capabilities
- Improving overall website design, including structure, appearance and responsiveness

The PCjs web server includes a number of custom Node modules that provide many of the same server-side features
found on [jsmachines.net](http://jsmachines.net/), including new ROM and disk image conversion APIs, and a
Markdown module that supports a subset of the [Markdown syntax](http://daringfireball.net/projects/markdown/syntax),
including extensions to the link syntax that make it easy to embed C1Pjs and PCjs machine files in Markdown documents.

---

### License

The **JSMachines** project is maintained on [GitHub](http://github.com/) (public release date TBD).  The portions
of the project that have been published here are free for redistribution and/or modification under the terms
of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License,
or (at your option) any later version.

You are required to include the appropriate copyright notice (e.g., `PCjs v1.15.3 © 2012-2014 by @jeffpar`)
in every source code file of every copy or modified version of this work, and to display that copyright notice
on every screen that loads or runs any version of this software.

See [LICENSE](/LICENSE) for details.

---

### More Information

If you have questions or run into any problems, you're welcome to [tweet](http://twitter.com/jeffpar) or
[email](mailto:Jeff@pcjs.org).