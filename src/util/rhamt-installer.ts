/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as requestTypes from 'request';
import * as fileSystem from 'fs';
import * as fs from 'fs-extra';
import { Disposable, ProgressLocation, window } from 'vscode';
import * as tmp from 'tmp';
const requestProgress = require('request-progress');
import * as path from 'path';
import { createDeferred } from './async';
import { ChangeType } from '../model/model';

export type TemporaryFile = { filePath: string } & Disposable;

const downloadFileExtension = '.nupkg';

export class Watch {
    private started: number = Date.now();
    public get elapsedTime() {
        return Date.now() - this.started;
    }
    public reset() {
        this.started = Date.now();
    }
}

export class InstallHandler {
    log: (data: string) => void;
}

export class RhamtInstaller {

    static installCli(url: string, downloadDir: string, handler: InstallHandler): Promise<any> {
        return new Promise<any> ((resolve, reject) => {
            RhamtInstaller.downloadRhamt(url, downloadDir, handler).then(home => {
                console.log('download & extract complete');
                resolve(home);
            }).catch(e => {
                console.log('error download & extract: ' + e);
                reject({type: ChangeType.ERROR, name: 'installCliChanged', value: {url, downloadDir, e}});
            });
        });
    }

    private static async downloadRhamt(url: string, downloadDir: string, handler: InstallHandler): Promise<string> {
        const downloadUri = url;
        const timer: Watch = new Watch();
        let localTempFilePath = '';

        try {
            localTempFilePath = await RhamtInstaller.downloadFile(downloadUri, 'Downloading mta-cli... ', handler);
        } catch (err) {
            return Promise.reject(err);
        }

        timer.reset();

        let home = '';
        try {
            home = await RhamtInstaller.unpackArchive(downloadDir, localTempFilePath, handler);
        } catch (err) {
            return Promise.reject(err);
        } finally {
            await RhamtInstaller.deleteFile(localTempFilePath);
        }
        return Promise.resolve(home);
    }

    private static deleteFile(filename: string): Promise<void> {
        const deferred = createDeferred<void>();
        fs.unlink(filename, err => err ? deferred.reject(err) : deferred.resolve());
        return deferred.promise;
    }

    private static createTemporaryFile(extension: string): Promise<TemporaryFile> {
        return new Promise<TemporaryFile>((resolve, reject) => {
            tmp.file({ postfix: extension }, (err, tmpFile, _, cleanupCallback) => {
                if (err) {
                    return reject(err);
                }
                resolve({ filePath: tmpFile, dispose: cleanupCallback });
            });
        });
    }

    private static createWriteStream(filePath: string): fileSystem.WriteStream {
        return fileSystem.createWriteStream(filePath);
    }

    private static objectExists(filePath: string, statCheck: (s: fs.Stats) => boolean): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            fs.stat(filePath, (error, stats) => {
                if (error) {
                    return resolve(false);
                }
                return resolve(statCheck(stats));
            });
        });
    }

    private static directoryExists(filePath: string): Promise<boolean> {
        return RhamtInstaller.objectExists(filePath, (stats: any) => stats.isDirectory());
    }

    private static createDirectory(directoryPath: string): Promise<void> {
        return fs.mkdirp(directoryPath);
    }

    private static async downloadFile(uri: string, title: string, handler: InstallHandler): Promise<string> {
        handler.log(`Downloading ${uri}... `);
        const tempFile = await RhamtInstaller.createTemporaryFile(downloadFileExtension);

        const deferred = createDeferred();
        const fileStream = RhamtInstaller.createWriteStream(tempFile.filePath);
        fileStream.on('finish', () => {
            fileStream.close();
        }).on('error', (err: any) => {
            tempFile.dispose();
            deferred.reject(err);
        });

        await window.withProgress({
            location: ProgressLocation.Window
        }, async progress => {
            const req = await RhamtInstaller.doDownloadFile(uri);
            requestProgress(req)
                .on('progress', (state: any) => {
                    const received = Math.round(state.size.transferred / 1024);
                    const total = Math.round(state.size.total / 1024);
                    const percentage = Math.round(100 * state.percent);
                    handler.log(`${title}${received} of ${total} KB (${percentage}%)`);
                    progress.report({
                        message: `${title}${received} of ${total} KB (${percentage}%)`
                    });
                })
                .on('error', (err: any) => {
                    deferred.reject(err);
                })
                .on('end', () => {
                    deferred.resolve();
                })
                .pipe(fileStream);
            return deferred.promise;
        });

        return tempFile.filePath;
    }

    private static async unpackArchive(downloadDir: string, tempFilePath: string, handler: InstallHandler): Promise<string> {
        handler.log('Unpacking archive... ');

        const deferred = createDeferred();

        const title = 'Extracting mta-cli... ';
        await window.withProgress({
            location: ProgressLocation.Window
        }, (progress: any) => {
            const StreamZip = require('node-stream-zip');
            const zip = new StreamZip({
                file: tempFilePath,
                storeEntries: true
            });

            let totalFiles = 0;
            let extractedFiles = 0;
            zip.on('ready', async () => {
                totalFiles = zip.entriesCount;
                if (!await RhamtInstaller.directoryExists(downloadDir)) {
                    await RhamtInstaller.createDirectory(downloadDir);
                }
                zip.extract(null, downloadDir, (err: any) => {
                    if (err) {
                        deferred.reject(err);
                    } else {
                        deferred.resolve();
                    }
                    zip.close();
                });
            }).on('extract', () => {
                extractedFiles += 1;
                progress.report({ message: `${title}${Math.round(100 * extractedFiles / totalFiles)}%` });
            }).on('error', (e: any) => {
                deferred.reject(e);
            });
            return deferred.promise;
        });

        const entries = fileSystem.readdirSync(downloadDir);
        const index = entries.findIndex(index => index.startsWith('mta-cli'));
        if (index > -1) {
            const executablePath = path.join(downloadDir, entries[index], 'bin', 'mta-cli');
            await fs.chmod(executablePath, '0764');
            return Promise.resolve(path.join(downloadDir, entries[index]));
        }
        else {
            return Promise.reject();
        }
    }

    private static async doDownloadFile(uri: string): Promise<requestTypes.Request> {
        const request = await import('request') as any as typeof requestTypes;
        return request(uri, {});
    }
}
