import * as express from 'express';
import * as path from 'path';
import * as bodyParser from 'body-parser';
import * as http from 'http';
import * as io from 'socket.io';
import * as serveStatic from 'serve-static';
import { Endpoints } from '../model/model';
import { ConfigurationServerController } from './configurationServerController';
import { ClientConnectionService } from './clientConnectionService';

export class ConfigurationServer {

    public app: express.Application;
    private server: http.Server;
    private endpoints: Endpoints;
    private controller: ConfigurationServerController;
    private controllerService: ClientConnectionService;

    constructor(
            endpoints: Endpoints,
            controller: ConfigurationServerController,
            controllerService: ClientConnectionService) {
        this.endpoints = endpoints;
        this.controller = controller;
        this.controllerService = controllerService;
    }

    public start(): void {
        this.app = express();
        this.server = this.app.listen(this.endpoints.configurationPort());
        const listener = io.listen(this.server);
        listener.sockets.on('connection', this.connectClient.bind(this));
        this.configServer();
        this.routes();
    }

    connectClient(s: io.Socket) {
        this.controllerService.connect(s);
    }

    private configServer() {
        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: true }));
        this.app.set('views', path.join(__dirname, '..', '..', 'resources', 'views'));
        this.app.set('view engine', 'jade');
        this.app.use(express.static(path.join(__dirname, '..', '..', 'resources')));
        this.app.use('/node_modules', express.static(path.join(__dirname, '..', '..', 'node_modules')));
        this.app.use('/out', express.static(path.join(__dirname, '..', '..', 'out')));
        this.app.use(serveStatic(path.join(__dirname, '..', '..', 'data')));
        this.app.use(function(err: any, req: express.Request, res: express.Response, next: express.NextFunction) {
            err.status = 404;
            next(err);
        });
    }

    private routes() {
        const router = express.Router();
        router.get('/:id', this.controller.get.bind(this.controller));
        router.get('/configuration/:id', this.controller.configuration.bind(this.controller));
        this.app.use(router);
    }

    public dispose(): void {
        this.server.close();
    }
  }