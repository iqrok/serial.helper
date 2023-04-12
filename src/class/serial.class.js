const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');
const InterByteTimeout = require('@serialport/parser-inter-byte-timeout');
const EventEmitter = require('events');

/**
 * Change data to buffer
 * Integer will be truncated to first byte, because serial sending data in byte
 * Because every number is a Double in JS and byte order can vary between device, this method doesn't handle number type other than Int8
 * Float, Double, Int16, or Int32 must be converted to buffer before passed to this function
 * @param {string|byte|Array<byte>} data - data to convert
 * @return {Buffer}
 */
function _toBuffer(data){
	if(Buffer.isBuffer(data)){
		return data;
	}

	if(Array.isArray(data)){
		return Buffer.from(data);
	}

	if(Number.isInteger(data) || data === undefined || data === null || typeof(data) === 'boolean'){
		return Buffer.from([+data]);
	}

	return Buffer.from(String(data));
}

/**
 * Process received string and try to parse it to JSON if possible
 * @param {string} data - received string from serial
 * @return {Object} - status and data
 */
function _handleStringResponse(data){
	// remove trailing whitespace
	data = data.trim();

	try {
		return {
			status : true,
			data : JSON.parse(data),
		};
	} catch(error) {
		return {
			status : true,
			data,
		};
	}
}

/**
 * Async sleep function.
 * @param ms Amount to sleep in milliseconds.
 */
function sleep(ms){
	return new Promise(resolve => setTimeout(resolve, ms))
}

'use strict;'
class serial extends EventEmitter {
	/**
	 * Constructor
	 * @param {Object} config - Serial configuration
	 * @param {string} config.port - Path to serial port
	 * @param {number} config.baud - Baud Rate for serial communication
	 * @param {boolean} [config.autoreconnect=true] - Autoreconnect on lost connection
	 * @param {boolean} [config.autoopen=true] - Auto open port on creating class
	 * @param {number} [config.reconnectInterval=3000] - Interval in ms for reconnecting if autoreconnect is true
	 * @param {Object} [config.parser] - set parser, if left empty then readline is used to parse every message
	 * @param {string} [config.parser.type] - parser type, possible value is InterByteTimeout
	 * @param {number} [config.parser.interval] - interval between message to be considered as new data
	 * @param {boolean} [debug=false] - Print debug message
	 */
	constructor(config, debug = false ) {
		super();
		const self = this;

		self.conf = config;
		self.conf.autoreconnect = self.conf.autoreconnect == null ? true : self.conf.autoreconnect;
		self.conf.autoopen = self.conf.autoopen == null ? true : self.conf.autoopen;
		self.reconnectInterval = self.conf.reconnectInterval || 3000;
		self.debug = self.conf.debug != null ? self.conf.debug : debug;

		self.isOpen = false;

		if(self.conf.autoopen){
			this.connect();
		}
	};

	/**
	 * static method as an alias to SerialPort.list()
	 * @return {Promise} - resolve to array of available ports
	 */
	static list(){
		return SerialPort.list();
	};

	/**
	 * soft reset for arduino leonardo
	 * @param {boolean} [baudRate=1200] - baud rate for executing soft reset, should be 1200bps for leonardo
	 */
	_softReset(baudRate = 1200){
		const self = this;

		return new Promise(async (resolve, reject) => {
			try{
				const leonardo = new SerialPort(self.conf.port, {baudRate});

				leonardo.on('error', async error => {
					await sleep(100);
					return resolve(self._softReset());
				});

				await sleep(100);
				leonardo.close();
				await sleep(100);

				return resolve(true);
			} catch(error){
				return resolve(self._softReset());
			}
		});
	};

	/**
	 * write data to serial port
	 * @name write
	 * @param {string|number|number[]} data - data to write
	 * @param {string} [encoding='utf8'] - data will be encoded according to this encoding
	 * @return {Pronmise} - will resolve when stream is drained
	 */
	write(data, encoding = 'utf8'){
		const self = this;

		return new Promise((resolve, reject) => {
			// write data to serial port
			self.port.write(_toBuffer(data), encoding, error => {
				if(error){
					if(self.debug){
						console.error('serial write error : ', error);
					}

					self.emit('error', error);
					resolve(false);
					return;
				}
			});

			// wait until serial to finish transmitting to the target serial port
			self.port.drain(() => {
				if(self.debug == 'verbose' || self.debug == 2){
					console.log('serial write data: ', data, _toBuffer(data));
				}

				resolve(true);
				return;
			});
		});
	};

	/**
	 * write String to serial port
	 * @param {string} msg - string to write
	 * @return {Pronmise} - will resolve when stream is drained
	 */
	print(msg){
		const self = this;
		return self.write(String(msg));
	};

	/**
	 * write string to serial port with trailing newline
	 * @param {string} msg - string to write
	 */
	println(msg){
		const self = this;
		return self.print(msg + '\n');
	};

	/**
	 * Register all event listeners
	 */
	_registerListeners(){
		const self = this;

		self.port.on('close', () => {
			self.isOpen = false;

			if(self.conf.autoreconnect === true){
				setTimeout(async () => {
						if(self.debug){
							console.error(`Attempting to reconnect ${self.conf.port}[${self.conf.baud}bps]...`);
						}
						await self.connect();
					}, self.reconnectInterval);
			}

			self.emit('close', self.conf.port + ' is closed');
		});

		self.port.on('error', error => {
			self.emit('error', error);
		});

		self.port.on('open', () => {
			self.isOpen = true;
			self.emit('open', 'Connected to:' + self.conf.port + ' baudrate:' + self.conf.baud + 'bps');
		});

		self.registerDataListener();
	};

	/**
	 * Connect to serial port
	 */
	async connect(){
		const self = this;

		if(self.conf.softReset == true){
			await self._softReset();
			self.conf.softReset = false;
		}

		return new Promise((resolve, reject) => {
			self.port = new SerialPort(self.conf.port, {
						baudRate: parseInt(self.conf.baud)
					},
					function (error) {
						if(error) {
							if(self.debug){
								self.emit('error', error);
							}

							if(self.conf.autoreconnect === true){
								setTimeout(()=>{
										if(self.debug){
											console.error(`Attempting to reconnect ${self.conf.port}[${self.conf.baud}bps]...`);
										}

										resolve(self.connect());
									}, self.reconnectInterval);
							} else {
								reject(error);
							}
							return;
						}

						resolve(true);
						return;
					}
				);

			self._registerListeners();
		});
	};

	/**
	 * Disconnect and remove all listeners
	 */
	disconnect(){
		const self = this;

		self.port.close();
		self.port.removeAllListeners('data');
		self.port.removeAllListeners('close');
		self.port.removeAllListeners('open');
		self.port.removeAllListeners('error');
		self.removeDataListener();
	};

	/**
	 * Register Data Parser Listener & Emitter
	 * @param {boolean} addEmitter - add global emitter or not
	 */
	registerDataListener(addEmitter = true){
		const self = this;

		if(self.conf.parser && self.conf.parser.type === 'InterByteTimeout'){
			const interval = self.conf.parser && self.conf.parser.interval ? self.conf.parser.interval : 30;
			self._parser = self.port.pipe(new InterByteTimeout({interval}));

			if(addEmitter){
				self._parser.on('data', received => {
					self.emit('data', received);
				});
			}
		} else{
			const delimiter = self.conf.parser && self.conf.parser.delimiter ? self.conf.parser.delimiter : '\n';
			self._parser = self.port.pipe(new Readline(delimiter));

			if(addEmitter){
				self._parser.on('data', data => {
					const response = _handleStringResponse(data);

					// only emit data if it's not empty or if it's an integer
					if(response.data || Number.isInteger(response.data)){
						self.emit('data',response);
					}
				});
			}
		}
	};

	/**
	 * Remove Data Parser Listener & Emitter
	 */
	removeDataListener(){
		const self = this;

		if(self._parser != undefined && self._parser.listenerCount('data') > 0){
			self._parser.removeAllListeners('data');
		}
	};

	/**
	 * request data to serial port by sending specific commands and wait for the response
	 * @param {string|number|number[]} data - data to write
	 * @param {string} [encoding='utf8'] - data will be encoded according to this encoding
	 * @return {Promise} - will resolve until data is received
	 */
	request(data, timeout = 1000, encoding = 'utf8'){
		const self = this;

		return new Promise((resolve, reject) => {
			const cb = received => {
					clearTimeout(interrupt);
					resolve(received);
					self._parser.removeListener('data', cb);
				};

			const interrupt = setTimeout(() => {
					self._parser.removeListener('data', cb);
					resolve(null)
				}, timeout);

			// write data to serial port
			self.port.write(_toBuffer(data), encoding, error => {
				if(error){
					if(self.debug){
						console.error('serial request error : ', error);
					}

					self.emit('error', error);
					resolve(false);
					return;
				}
			});

			// wait for response to resolve promise
			if(self.conf.parser && self.conf.parser.type === 'InterByteTimeout'){
				self._parser.once('data', cb);
			} else {
				self._parser.once('data', data => {
					clearTimeout(interrupt);
					resolve(_handleStringResponse(data));
				});
			}
		});
	};
}

module.exports = serial;
